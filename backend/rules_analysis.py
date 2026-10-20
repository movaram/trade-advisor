"""Free, deterministic EP analysis: the same JSON shape the LLM path returns (see SYSTEM_PROMPT in
main.py), built from price/volume numbers plus keyword matching over the news feed. It's the
default analyzer and the fallback whenever the optional free LLM (Gemini) is unavailable, so it
must never raise on odd inputs -- missing news, missing indicators, unparseable numbers all just
degrade to a weaker, honestly-labelled answer.

Known limits (surfaced to the user in the explanations rather than hidden): no Russian retelling
of the news (the original English description is shown), no sector-relative strength data for
the momentum M5 check, and catalyst typing is only as good as the keyword rules below."""

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MarketData:
    ticker: str
    company_name: str
    date_str: str
    open: float
    high: float
    low: float
    close: float
    price_change_pct: float
    volume_ratio: float
    move_30d_pct: float
    move_90d_pct: float
    high_90d: float
    low_90d: float
    ema21: Optional[float]
    sma50: Optional[float]
    market_cap: Optional[float]
    lookback: list[dict]  # prior daily bars, oldest -> newest (Massive aggs: o/h/l/c/v)
    news: list[dict] = field(default_factory=list)  # each has days_from_event set by main.py


# --- Catalyst rules --------------------------------------------------------------------------
# Checked in this order; the first rule matching a news item is that item's category, so more
# specific rules come before broader ones (e.g. "accelerated approval" before "FDA approval",
# "earnings beat + guidance" before plain "beat").
EARNINGS = r"(earnings|results|quarter|q[1-4]\b|eps|per share|fiscal)"
BEAT = r"(beat|beats|beating|tops|topped|exceed|surpass|crush|blowout|blockbuster|smash|better[- ]than[- ]expected)"
GUIDE_UP = r"(rais\w* (\w+ ){0,2}(guidance|outlook|forecast)|(guidance|outlook|forecast)\w* (above|ahead of|tops|beat|raised)|(strong|robust|upbeat|solid|bullish) (\w+ ){0,2}(guidance|outlook|forecast)|guid\w* (\w+ ){0,3}(above|ahead))"

CATALYST_RULES: list[tuple[int, str, list[str]]] = [
    # (catalyst number, name, regexes that must ALL match the lowercased title+description)
    (11, "FDA accelerated approval", [r"accelerated approval"]),
    (12, "FDA Fast Track designation", [r"fast track"]),
    (13, "FDA Breakthrough Therapy designation", [r"breakthrough therapy"]),
    (14, "FDA Special Protocol Assessment (SPA)", [r"special protocol assessment"]),
    (10, "FDA full approval — first-in-class", [r"\bfda\b", r"approv"]),
    (15, "Phase 3 positive — primary endpoint met", [r"phase (3|iii)\b", r"(positive|met|achiev|success|primary endpoint)"]),
    (16, "Phase 2 positive data", [r"phase (2|ii)\b", r"(positive|met|achiev|success|promising)"]),
    (17, "Phase 1 positive / IND clearance", [r"(phase (1|i)\b|\bind\b clearance|ind application)"]),
    (8, "M&A — acquisition target", [r"(to be acquired|agrees? to be (bought|acquired)|acquired by|takeover (offer|bid) for|buyout offer|go(ing)? private)"]),
    (9, "M&A rumor (tier-1 source: Bloomberg/Reuters/FT)", [r"(explor\w* (a )?sale|takeover interest|weighs? (a )?sale|in talks to (buy|acquire|merge)|considering (a )?sale)"]),
    (7, "M&A — definitive agreement (acquirer)", [r"(to acquire|definitive agreement|agrees? to (buy|acquire)|acquisition of|merger agreement)"]),
    (1, "Earnings beat + guidance raise", [EARNINGS, BEAT, GUIDE_UP]),
    (3, "Beating analyst estimates", [EARNINGS, BEAT]),
    (2, "Revenue / sales growth", [r"(revenue|sales) (grew|growth|jump|surge|rose|up \d)"]),
    (26, "Dutch auction tender offer", [r"(dutch auction|tender offer)"]),
    (25, "Buyback — large scale (>10% float)", [r"(buyback|share repurchase|repurchase program)"]),
    (28, "Index inclusion (Russell, S&P)", [r"(added to the s&p|join(s|ing)? the s&p|s&p (500|400|600) (index )?(inclusion|addition)|russell (1000|2000|3000) (inclusion|addition)|index inclusion)"]),
    (31, "IPO upsized — top of range", [r"(\bipo\b|initial public offering)", r"(upsiz|above the range|top of (the )?range|prices)"]),
    (23, "Government contract / binding award", [r"(department of (defense|energy|war)|\bdod\b|pentagon|u\.s\. army|u\.s\. navy|air force|nasa|government contract|federal contract)", r"(contract|award|order)"]),
    (6, "Binding contract / signed deal", [r"(contract|signed|agreement|order|deal|partnership|supply)", r"(win|wins|won|award|sign|secur|land|announc|enter)"]),
    (38, "Non-binding LOI / unnamed partner (weak)", [r"(letter of intent|non-binding|\bloi\b|unnamed partner|undisclosed customer)"]),
    (43, "Activist investor — takes stake + demands change", [r"(activist|13d\b|takes? (a )?stake|board seats?)"]),
    (4, "Analyst upgrade + price target raise (tier-1)", [r"(upgrad|raises? (its |the )?price target|price target (raised|hike|increase)|\bpt\b (raise|to \$))"]),
    (5, "Analyst initiation (post-IPO quiet period)", [r"(initiat\w* (coverage|at|with)|starts? coverage)"]),
    (21, "New management / CEO change", [r"(\bceo\b|chief executive)", r"(appoint|names?|named|steps? down|resign|replace|successor|hire)"]),
    (24, "Patent monetization / legal settlement", [r"(settlement|patent|licens\w* agreement|verdict)"]),
    (36, "Securities fraud / class action (negative)", [r"(class action|securities fraud|investigation on behalf)"]),
    (37, "Reverse split (negative)", [r"reverse (stock )?split"]),
    (35, "Service failure (negative)", [r"(outage|recall|breach|halt\w* production)"]),
    (22, "Government policy change", [r"(tariff|executive order|regulat\w* (change|approval)|policy|subsid|chips act|white house)"]),
    (20, "Product launch — commercial revenue", [r"(launch|unveil|introduc|commercial availability|begins shipping)"]),
    (19, "Technology milestone / scalability proof", [r"(milestone|breakthrough|record (performance|efficiency)|first[- ]ever|demonstrat)"]),
]

NEGATIVE_CATALYSTS = {35, 36, 37}

# Categories that describe the same underlying event at different strengths; their news is pooled
# so e.g. ten "beat estimates" articles plus two that also mention raised guidance add up to one
# earnings catalyst, labelled with the most specific category any of them matched.
CATEGORY_FAMILY = {1: "earnings", 2: "earnings", 3: "earnings", 10: "fda", 11: "fda", 12: "fda", 13: "fda", 14: "fda", 4: "analyst", 5: "analyst"}
RULE_ORDER = {number: i for i, (number, _, _) in enumerate(CATALYST_RULES)}

NARRATIVE_WORDS = r"(\bai\b|artificial intelligence|agentic|data cent(er|re)|gpu|semiconductor|chip|defen[cs]e|drone|nuclear|uranium|energy|quantum|robot|space|satellite|crypto|bitcoin|turnaround|first profit|record (revenue|quarter|results)|obesity|glp-1)"

ANALYST_T1 = ["goldman", "morgan stanley", "jpmorgan", "jp morgan", "ubs", "barclays", "bank of america", "bofa"]
ANALYST_T2 = ["oppenheimer", "needham", "canaccord", "rbc", "piper sandler", "william blair"]
ANALYST_ACTION = r"(upgrad|raises? (its |the )?price target|price target (to|raised|from)|initiat\w* coverage|reiterat)"

COMPANY_SUFFIXES = r"\b(corp(oration)?|inc|incorporated|holdings?|ltd|limited|plc|co|company|group|technologies|class [a-c]|common stock|ordinary shares|n\.?v|s\.?a|ag)\b\.?"


def _company_keywords(ticker: str, company_name: str) -> list[str]:
    name = re.sub(COMPANY_SUFFIXES, "", company_name.lower())
    name = re.sub(r"[^a-z0-9& ]", " ", name).split()
    keys = [ticker.lower()]
    if name:
        keys.append(name[0])  # "intel", "nvidia", "advanced" -> first word is usually enough
        if len(name) > 1 and len(name[0]) <= 3:
            keys.append(" ".join(name[:2]))
    return keys


def _text(n: dict) -> str:
    return f"{n.get('title') or ''}. {n.get('description') or ''}".lower()


def _mentions_company(n: dict, keys: list[str]) -> int:
    """2 = company named in the headline, 1 = only in the description, 0 = not at all."""
    title = (n.get("title") or "").lower()
    desc = (n.get("description") or "").lower()
    pattern = lambda k: rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])"
    if any(re.search(pattern(k), title) for k in keys):
        return 2
    if any(re.search(pattern(k), desc) for k in keys):
        return 1
    return 0


def _classify(n: dict) -> Optional[tuple[int, str]]:
    text = _text(n)
    for number, name, patterns in CATALYST_RULES:
        if all(re.search(p, text) for p in patterns):
            return number, name
    return None


# --- Number parsing --------------------------------------------------------------------------

def _money(s: str) -> Optional[float]:
    """'$0.29' -> 0.29, '29 cents' -> 0.29, '1 cent' -> 0.01, '-$0.05' -> -0.05."""
    s = s.strip().lower().replace(",", "")
    m = re.match(r"^(-|minus |a loss of )?\$?(\d+(?:\.\d+)?)\s*(cents?|c)?$", s)
    if not m:
        return None
    value = float(m.group(2))
    if m.group(3):
        value /= 100
    return -value if m.group(1) else value


EPS_VALUE = r"(-?\$-?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*cents?)"
EPS_PAIR_PATTERNS = [
    # "$0.29 vs. $0.01", "29 cents versus 1 cent"
    rf"{EPS_VALUE}[^.;]{{0,40}}?\b(?:vs\.?|versus|compared (?:with|to))\s*(?:the |an? )?(?:expected |estimated |consensus )?{EPS_VALUE}",
    # "$0.29 ... beating/topping (the) estimate(s) of 1 cent", "... expectations of 1 cent"
    rf"{EPS_VALUE}[^.;]{{0,80}}?(?:estimates?|expectations?|consensus|forecasts?)\s*(?:of|for|at|was|were)?\s*(?:about |around |roughly )?{EPS_VALUE}",
]


def _eps_beat_pct(texts: list[str]) -> Optional[float]:
    """Largest parsed EPS surprise (%) across the catalyst news, or None if no actual-vs-estimate
    pair could be read. Only looks at sentences that are actually about per-share earnings so a
    revenue pair ("$13.58B vs $12.4B") isn't mistaken for EPS."""
    best = None
    for text in texts:
        for sentence in re.split(r"(?<=[.;])\s+", text):
            if not re.search(r"(eps|per share|cents|earnings of)", sentence):
                continue
            if re.search(r"\b(billion|million|bn)\b", sentence) and not re.search(r"(eps|per share)", sentence):
                continue
            for pattern in EPS_PAIR_PATTERNS:
                for m in re.finditer(pattern, sentence):
                    actual, estimate = _money(m.group(1)), _money(m.group(2))
                    if actual is None or estimate is None or actual == estimate:
                        continue
                    if estimate <= 0:
                        pct = 999.0 if actual > estimate else -999.0
                    else:
                        pct = (actual - estimate) / estimate * 100
                    if best is None or pct > best:
                        best = pct
    return best


def _largest_dollar_amount(texts: list[str]) -> Optional[float]:
    best = None
    for text in texts:
        for m in re.finditer(r"\$(\d+(?:\.\d+)?)\s*(billion|bn|b\b|million|mn|m\b)", text):
            value = float(m.group(1)) * (1e9 if m.group(2).startswith("b") else 1e6)
            best = value if best is None else max(best, value)
    return best


def _analyst_activity(news: list[dict]) -> Optional[dict]:
    """Distinct analyst firms acting within a day of the event, their best tier, and the largest
    PT raise that could be parsed ("to $X from $Y" / "from $Y to $X")."""
    firms: dict[str, str] = {}
    max_raise = 0.0
    for n in news:
        d = n.get("days_from_event")
        if d is None or abs(d) > 1:
            continue
        text = _text(n)
        if not re.search(ANALYST_ACTION, text):
            continue
        for name in ANALYST_T1:
            if name in text:
                firms[name] = "T1"
        for name in ANALYST_T2:
            if name in text:
                firms.setdefault(name, "T2")
        if not any(name in text for name in ANALYST_T1 + ANALYST_T2):
            firms.setdefault(f"other:{n.get('title')}", "T3")
        for m in re.finditer(r"to \$(\d+(?:\.\d+)?) from \$(\d+(?:\.\d+)?)", text):
            new, old = float(m.group(1)), float(m.group(2))
            if old > 0:
                max_raise = max(max_raise, (new - old) / old * 100)
        for m in re.finditer(r"from \$(\d+(?:\.\d+)?) to \$(\d+(?:\.\d+)?)", text):
            old, new = float(m.group(1)), float(m.group(2))
            if old > 0:
                max_raise = max(max_raise, (new - old) / old * 100)
    if not firms:
        return None
    tiers = set(firms.values())
    highest = "T1" if "T1" in tiers else "T2" if "T2" in tiers else "T3"
    count = len(firms)
    return {
        "analyst_count": count,
        "highest_tier": highest,
        "max_pt_raise_pct": round(max_raise, 1),
        "summary": f"{count} analysts, highest tier: {highest}, max PT raise: +{max_raise:.1f}%",
    }


# --- Main entry ------------------------------------------------------------------------------

def _pick_catalyst(md: MarketData) -> tuple[Optional[tuple[int, str]], list[dict], list[dict]]:
    """Scores every company-relevant, classifiable news item and returns (category, the items of
    that category sorted oldest first, all relevant items). Items from the evening before / the
    event day weigh most, since that's where an EP catalyst lives; post-move coverage still counts
    a little because it usually names the reason for the move."""
    keys = _company_keywords(md.ticker, md.company_name)
    relevant = []
    scores: dict[object, float] = {}
    members: dict[object, list[tuple[tuple[int, str], dict]]] = {}
    for n in md.news:
        mention = _mentions_company(n, keys)
        if not mention:
            continue
        relevant.append(n)
        category = _classify(n)
        if not category:
            continue
        d = n.get("days_from_event")
        if d is None:
            timing = 1.0
        elif -1 <= d <= 0:
            timing = 3.0
        elif 1 <= d <= 3:
            timing = 1.5
        elif -4 <= d <= -2:
            timing = 1.0
        else:
            timing = 0.5
        tier_bonus = {1: 1.5, 2: 1.0, 3: 0.7}.get(n.get("source_tier") or 2, 1.0)
        family = CATEGORY_FAMILY.get(category[0], category)
        scores[family] = scores.get(family, 0) + mention * timing * tier_bonus
        members.setdefault(family, []).append((category, n))
    if not scores:
        return None, [], relevant
    best = max(scores, key=lambda f: scores[f])
    category = min((c for c, _ in members[best]), key=lambda c: RULE_ORDER[c[0]])
    items = sorted((n for _, n in members[best]), key=lambda n: n.get("published_date") or "")
    return category, items, relevant


def _first_release(items: list[dict], keys: list[str], category: tuple[int, str]) -> Optional[dict]:
    """The catalyst news itself: from the earliest day with coverage no later than the event day
    (falling back to post-move coverage only), the most reliable item -- best source tier, then
    company named in the headline, then the most detailed description."""
    pool = [n for n in items if (n.get("days_from_event") or 0) <= 0] or items
    if not pool:
        return None
    first_day = min(n.get("published_date") or "" for n in pool)
    same_day = [n for n in pool if (n.get("published_date") or "") == first_day]
    def headline_on_topic(n: dict) -> bool:
        # e.g. "Intel Stock Soars After Blockbuster Q1 Earnings" beats "Trump's Intel Stake Is Up
        # 290%", which only mentions the earnings in its description
        title_only = _classify({"title": n.get("title")})
        return title_only is not None and CATEGORY_FAMILY.get(title_only[0], title_only) == CATEGORY_FAMILY.get(category[0], category)
    return min(same_day, key=lambda n: (
        not headline_on_topic(n), n.get("source_tier") or 2, -_mentions_company(n, keys), -len(n.get("description") or ""),
    ))


def analyze_with_rules(md: MarketData) -> dict:
    category, cat_items, relevant = _pick_catalyst(md)
    catalyst_news = _first_release(cat_items, _company_keywords(md.ticker, md.company_name), category) if category else None
    cat_texts = [_text(n) for n in cat_items]
    days_from_event = catalyst_news.get("days_from_event") if catalyst_news else None
    eps_beat = _eps_beat_pct(cat_texts) if category and category[0] in (1, 2, 3) else None
    analyst = _analyst_activity(relevant)
    fresh_catalyst = category is not None and days_from_event is not None and days_from_event >= -1
    above_21 = md.ema21 is not None and md.close > md.ema21
    above_50 = md.sma50 is not None and md.close > md.sma50

    # --- setup type ---
    failed_breakout = (
        md.high > md.high_90d and md.close <= md.high_90d and md.close < md.open and md.volume_ratio >= 1.5
    )
    extended = max(md.move_30d_pct, md.move_90d_pct) >= 30
    near_high = md.high_90d > 0 and md.close >= md.high_90d * 0.9
    if failed_breakout:
        setup_type, setup_explanation = "FAILED_BREAKOUT", (
            f"Максимум дня ${md.high:.2f} пробил 90-дневный максимум ${md.high_90d:.2f}, но закрытие "
            f"${md.close:.2f} вернулось ниже него и ниже открытия на объёме {md.volume_ratio:.1f}x."
        )
    elif fresh_catalyst:
        setup_type, setup_explanation = "EP", "Свежий новостной катализатор накануне или в день движения."
    elif category and days_from_event is not None and days_from_event <= -5:
        setup_type, setup_explanation = "DEP", f"DEP — реакция через {-days_from_event} дн. после катализатора."
    elif extended and near_high:
        setup_type, setup_explanation = "MOMENTUM", (
            f"Акция уже выросла на {max(md.move_30d_pct, md.move_90d_pct):.0f}% за 1–3 месяца и торгуется у максимумов; "
            "свежего катализатора в новостях не найдено."
        )
    else:
        setup_type, setup_explanation = "EP", (
            "Свежего катализатора в новостях не найдено — оценка по движению цены и объёма."
            if not category else "Катализатор найден, но вне окна ±1 день от движения."
        )

    # --- catalyst text ---
    if category:
        catalyst_type = f"#{category[0]} — {category[1]}"
        when = _days_label(days_from_event)
        facts = []
        if eps_beat is not None:
            facts.append("прибыль на акцию выше прогноза " + ("в разы" if eps_beat >= 999 else f"на {eps_beat:.0f}%"))
        facts.append(f"акция {md.price_change_pct:+.1f}% на объёме {md.volume_ratio:.1f}x от среднего")
        catalyst_description = (
            f"{catalyst_news.get('title')} ({catalyst_news.get('publisher') or 'источник неизвестен'}, {when}). "
            + "; ".join(facts).capitalize() + "."
        )
    else:
        catalyst_type = "— Катализатор не найден"
        catalyst_description = (
            f"В новостях Massive/Finnhub за окно вокруг даты не найдено новостей о {md.company_name}, "
            f"объясняющих движение {md.price_change_pct:+.1f}% на объёме {md.volume_ratio:.1f}x."
            if not relevant else
            f"Новости о {md.company_name} есть, но ни одна не подошла под известные типы катализаторов — "
            "проверьте их вручную в карточке News."
        )

    # --- checklist ---
    checklist_type = {"MOMENTUM": "momentum", "FAILED_BREAKOUT": "failed"}.get(setup_type, "ep")
    checklist = None
    if checklist_type == "ep":
        narrative_hit = next((m.group(0) for n in relevant if (m := re.search(NARRATIVE_WORDS, _text(n)))), None)
        strong_words = any(re.search(r"(crush|blowout|blockbuster|smash|soar|surprise|well above)", t) for t in cat_texts)
        if eps_beat is not None:
            q3 = eps_beat > 25
            q3_text = f"Прибыль на акцию выше прогноза {'в разы' if eps_beat >= 999 else f'на {eps_beat:.0f}%'} (порог — 25%)."
        elif category and category[0] in (1, 8, 10, 11, 15):
            q3, q3_text = True, f"Тип катализатора ({category[1]}) обычно означает сюрприз для рынка."
        elif category and strong_words:
            q3, q3_text = True, "Цифры не удалось извлечь, но новости описывают результат как сильный сюрприз."
        else:
            q3, q3_text = False, "Нет данных, что результат заметно лучше ожиданий."
        checklist = {
            "q1_ignored": md.move_30d_pct < 15 and md.move_90d_pct < 50,
            "q1_explanation": f"За 30 дней до события {md.move_30d_pct:+.1f}%, за 90 дней {md.move_90d_pct:+.1f}% (нужно <15% и не >50%).",
            "q2_volume": md.price_change_pct >= 5 and md.volume_ratio >= 2,
            "q2_explanation": f"Движение {md.price_change_pct:+.1f}% на объёме {md.volume_ratio:.1f}x (нужно ≥+5% и ≥2x).",
            "q3_better_than_expected": q3,
            "q3_explanation": q3_text,
            "q4_narrative": narrative_hit is not None,
            "q4_explanation": f"В новостях есть тема для новых покупателей: «{narrative_hit}»." if narrative_hit else "Горячей темы (AI, оборона, энергетика, разворот бизнеса…) в новостях не найдено.",
            "q5_technical": above_21 and above_50,
            "q5_explanation": _ma_text(md),
            "analyst_confirmation": analyst,
        }
    elif checklist_type == "momentum":
        checklist = _momentum_checklist(md)

    # --- catalyst strength ---
    dims = _catalyst_dimensions(md, category, cat_items, cat_texts, eps_beat, analyst, days_from_event)

    analysis = {
        "catalyst_type": catalyst_type,
        "catalyst_description": catalyst_description,
        "catalyst_news_date": catalyst_news.get("published_date") if catalyst_news else None,
        "catalyst_news_summary": catalyst_news.get("description") if catalyst_news else None,
        "rank": 0,  # filled in by finalize_rules_analysis once the verdict is known
        "rank_explanation": "",
        "setup_type": setup_type,
        "setup_explanation": setup_explanation,
        "checklist_type": checklist_type,
        "checklist": checklist,
        "key_risks": _key_risks(md, category, relevant),
        "similar_setups": [],
        "catalyst_strength": {"dimensions": dims},
        "action_plan": _action_plan(md, setup_type),
    }
    if setup_type == "FAILED_BREAKOUT":
        analysis["failed_breakout"] = {
            "failed_level": round(md.high_90d, 2),
            "reclaim_level": round(md.high, 2),
            "short_observation": setup_explanation,
        }
    return analysis


def finalize_rules_analysis(analysis: dict, md: MarketData, setup_score: float, catalyst_total: int, verdict: str) -> None:
    """Fills in the parts that depend on the backend's deterministic verdict (computed in main.py
    after this module returns): the 1-10 rank and, for WAIT/SKIP, what would have to change."""
    rank = round((setup_score / 5 * 0.5 + catalyst_total / 15 * 0.5) * 10)
    analysis["rank"] = max(1, min(10, rank))
    analysis["rank_explanation"] = (
        f"Автоматическая оценка по правилам: чек-лист {setup_score:g}/5, сила катализатора {catalyst_total}/15."
    )
    if verdict != "TRADE":
        plan = analysis.setdefault("action_plan", {})
        if analysis.get("setup_type") == "FAILED_BREAKOUT":
            plan["skip_conditions"] = (
                f"Лонг возможен только после закрытия обратно выше ${md.high_90d:.2f} (пробитый уровень), "
                f"надёжнее — выше ${md.high:.2f} (максимум дня); обычно 1–2 недели на новую базу."
            )
        elif catalyst_total <= 3:
            plan["skip_conditions"] = "Нужен подтверждённый новостной катализатор (отчёт, контракт, FDA и т.п.) с конкретными цифрами."
        else:
            plan["skip_conditions"] = (
                f"Ждать удержания выше ${md.low:.2f} и пробоя ${md.high:.2f} на объёме ≥1.5x; "
                "либо новую базу 2–6 недель над 21EMA."
            )


def _days_label(days: Optional[int]) -> str:
    if days is None:
        return "дата неизвестна"
    if days == 0:
        return "в день движения"
    return f"за {-days} дн. до движения" if days < 0 else f"через {days} дн. после движения"


def _ma_text(md: MarketData) -> str:
    def side(value: Optional[float], name: str) -> str:
        if value is None:
            return f"{name}: нет данных"
        return f"{'выше' if md.close > value else 'ниже'} {name} (${value:.2f})"
    return f"Закрытие ${md.close:.2f} — {side(md.ema21, '21EMA')}, {side(md.sma50, '50SMA')}."


def _momentum_checklist(md: MarketData) -> dict:
    bars = md.lookback
    last20 = bars[-20:]
    last5 = bars[-5:]
    prior15 = bars[-20:-5] or last20
    range_high = max(b["h"] for b in last20)
    range_low = min(b["l"] for b in last20)
    depth = (range_high - range_low) / range_high * 100 if range_high else 0
    held_50 = md.sma50 is None or bars[-1]["c"] >= md.sma50 * 0.98
    avg_range = lambda bs: sum((b["h"] - b["l"]) / b["c"] for b in bs) / len(bs)
    avg_vol = lambda bs: sum(b["v"] for b in bs) / len(bs)
    tightening = avg_range(last5) < avg_range(prior15) and avg_vol(last5) < avg_vol(prior15)
    close_pos = (md.close - md.low) / (md.high - md.low) if md.high > md.low else 1.0
    impulse = max(md.move_30d_pct, md.move_90d_pct)
    return {
        "m1_impulse": impulse >= 30,
        "m1_explanation": f"Рост за 30 дней {md.move_30d_pct:+.1f}%, за 90 дней {md.move_90d_pct:+.1f}% (нужно ≥30%).",
        "m2_consolidation": depth <= 25 and held_50,
        "m2_explanation": f"Диапазон последних 20 дней {depth:.0f}% (нужно ≤25%), 50SMA {'удержана' if held_50 else 'потеряна'}.",
        "m3_tightening": tightening,
        "m3_explanation": "Последние 5 дней: свечи уже и объём ниже, чем раньше." if tightening else "Сужения диапазона и снижения объёма перед пробоем нет.",
        "m4_breakout_day": close_pos >= 0.7 and md.volume_ratio >= 1.5,
        "m4_explanation": f"Закрытие в верхних {close_pos * 100:.0f}% диапазона дня, объём {md.volume_ratio:.1f}x (нужно ≥70% и ≥1.5x).",
        "m5_leadership": md.move_90d_pct >= 50,
        "m5_explanation": f"Данных по сектору нет; приближённо — рост за 90 дней {md.move_90d_pct:+.0f}% (≥50% считается лидерством).",
    }


def _catalyst_dimensions(md, category, cat_items, cat_texts, eps_beat, analyst, days_from_event) -> dict:
    if not category:
        zero = "Катализатор не найден."
        return {
            "source_quality": 0, "source_quality_explanation": zero,
            "specificity": 0, "specificity_explanation": zero,
            "magnitude": 0, "magnitude_explanation": zero,
            "analyst_confirmation": _analyst_score(analyst), "analyst_confirmation_explanation": _analyst_text(analyst),
            "novelty": 0, "novelty_explanation": zero,
        }

    best_tier = min((n.get("source_tier") or 2) for n in cat_items)
    source_quality = {1: 3, 2: 2, 3: 1}.get(best_tier, 2)
    publishers = ", ".join(sorted({n.get("publisher") or "?" for n in cat_items})[:3])

    amount = _largest_dollar_amount(cat_texts)
    is_earnings = category[0] in (1, 2, 3)
    if any(re.search(r"(undisclosed|unnamed|major (customer|hyperscaler|partner))", t) for t in cat_texts):
        specificity, spec_text = 1, "Партнёр/условия не названы."
    elif is_earnings or amount:
        specificity, spec_text = 3, "Конкретные цифры в новостях" + (f" (до ${amount / 1e6:,.0f} млн)." if amount and not is_earnings else ".")
    else:
        specificity, spec_text = 2, "Событие названо, но без суммы."

    if is_earnings and eps_beat is not None:
        magnitude = 3 if eps_beat > 50 else 2 if eps_beat > 25 else 1 if eps_beat > 10 else 0
        mag_text = "Прибыль выше прогноза " + ("в разы." if eps_beat >= 999 else f"на {eps_beat:.0f}%.")
    elif is_earnings:
        strong = any(re.search(r"(crush|blowout|blockbuster|smash|well above|soar)", t) for t in cat_texts)
        magnitude, mag_text = (2, "Цифры не извлечены; новости описывают сильное превышение.") if strong else (1, "Цифры прогноза не извлечены.")
    elif amount and md.market_cap:
        share = amount / md.market_cap * 100
        magnitude = 3 if share > 20 else 2 if share > 10 else 1
        mag_text = f"Сумма ≈{share:.1f}% от капитализации."
    else:
        magnitude, mag_text = 1, "Масштаб относительно капитализации оценить не удалось."
    if category[0] in NEGATIVE_CATALYSTS:
        magnitude, mag_text = 0, "Негативный катализатор."

    if days_from_event is not None and days_from_event >= -1:
        earlier = any(re.search(r"(preview|expected to|ahead of|rumou?r|reportedly)", t) for t in cat_texts)
        novelty, nov_text = (2, "Событие ожидалось (были превью/слухи), но детали новые.") if earlier else (3, "Новая информация накануне или в день движения.")
    elif days_from_event is not None and days_from_event <= -5:
        novelty, nov_text = 1, f"Новость вышла {-days_from_event} дн. назад — рынок уже знал."
    else:
        novelty, nov_text = 2, "Новость вышла за несколько дней до движения."

    return {
        "source_quality": source_quality, "source_quality_explanation": f"Лучший источник: Tier {best_tier} ({publishers}).",
        "specificity": specificity, "specificity_explanation": spec_text,
        "magnitude": magnitude, "magnitude_explanation": mag_text,
        "analyst_confirmation": _analyst_score(analyst), "analyst_confirmation_explanation": _analyst_text(analyst),
        "novelty": novelty, "novelty_explanation": nov_text,
    }


def _analyst_score(analyst: Optional[dict]) -> int:
    if not analyst:
        return 0
    count, tier = analyst["analyst_count"], analyst["highest_tier"]
    if count >= 3 and tier == "T1":
        return 3
    if tier == "T1" or (count >= 3 and tier == "T2"):
        return 2
    return 1


def _analyst_text(analyst: Optional[dict]) -> str:
    if not analyst:
        return "Действий аналитиков в день движения в новостях не найдено."
    return f"Аналитиков: {analyst['analyst_count']}, лучший уровень: {analyst['highest_tier']}, макс. повышение цели: +{analyst['max_pt_raise_pct']:.0f}%."


def _key_risks(md: MarketData, category, relevant) -> list[str]:
    risks = []
    if md.move_30d_pct >= 50:
        risks.append(f"Акция уже выросла на {md.move_30d_pct:.0f}% за 30 дней — высокий риск отката.")
    if md.ema21 and md.close > md.ema21 * 1.2:
        risks.append(f"Цена на {(md.close / md.ema21 - 1) * 100:.0f}% выше 21EMA — перегрев.")
    if md.volume_ratio < 2:
        risks.append(f"Объём только {md.volume_ratio:.1f}x от среднего — слабое подтверждение.")
    if (md.market_cap is not None and md.market_cap < 500_000_000) or md.close < 5:
        risks.append("Малая капитализация или цена < $5 — высокая волатильность, размер позиции уменьшен.")
    if not category:
        risks.append("Катализатор не подтверждён новостями.")
    elif relevant and all((n.get("source_tier") or 2) == 3 for n in relevant):
        risks.append("Только источники Tier 3 (мнения/комментарии) — проверить первоисточник.")
    if md.high > md.low and (md.close - md.low) / (md.high - md.low) < 0.4:
        risks.append("Закрытие в нижней части дневного диапазона — продавцы активны.")
    return risks or ["Явных рисков по цифрам не найдено — проверьте новости вручную."]


def _action_plan(md: MarketData, setup_type: str) -> dict:
    if setup_type == "MOMENTUM":
        pivot = max(b["h"] for b in md.lookback[-20:])
        base_low = min(b["l"] for b in md.lookback[-10:])
        return {
            "trigger": f"Пробой выше ${max(pivot, md.high):.2f} (верх консолидации)",
            "stop": f"${base_low:.2f} (минимум последних 10 дней)",
            "invalidation": f"Закрытие обратно ниже ${pivot:.2f} или потеря 21EMA",
            "management": "Продать часть позиции на +10–15%, остаток вести по 10EMA (по 21EMA, если база была 6+ недель).",
            "skip_conditions": None,
        }
    if setup_type == "FAILED_BREAKOUT":
        return {
            "trigger": f"Закрытие обратно выше ${md.high_90d:.2f}",
            "stop": f"${md.low:.2f}",
            "invalidation": f"Дальнейшее снижение ниже ${md.low:.2f}",
            "management": "",
            "skip_conditions": None,
        }
    return {
        "trigger": f"Пробой выше ${md.high:.2f} (максимум дня катализатора)",
        "stop": f"${md.low:.2f} (минимум дня катализатора)",
        "invalidation": f"Закрытие ниже ${md.low:.2f} (закрытие гэпа)",
        "management": "Продать часть позиции на +10–15%, остаток вести по 21EMA.",
        "skip_conditions": None,
    }
