"""Japanese search words -> the English words the library uses.

The library itself is in English, so a Japanese query finds nothing by keyword. to_english() turns the survival words
it knows into English search words (longest match first) and drops the rest (particles, words it does not know).
Latin words typed alongside are kept. Text with no Japanese in it is returned unchanged.

No network, no model: a fixed word list, so search still works when the local AI is off.
Each English side is what the manuals actually say; server.SYN widens it further (for example bleach -> chlorine).
"""
import re

JA = re.compile(r'[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]')

TERMS = {
    # water
    '飲み水': 'drinking water', '飲料水': 'drinking water', '水道水': 'tap water', '水道': 'water', '断水': 'water',
    '給水': 'water supply', '雨水': 'rainwater', '井戸': 'well', '海水': 'seawater', '塩水': 'salt water', '川の水': 'river water',
    '浄水': 'water treatment', 'ろ過': 'filter', '濾過': 'filter', 'フィルター': 'filter', '煮沸': 'boil', '沸騰': 'boil',
    '消毒': 'disinfect', '殺菌': 'disinfect', '漂白剤': 'bleach', '塩素': 'chlorine', '浄水錠': 'tablets', '貯水': 'water storage',
    '備蓄水': 'water storage', '給湯器': 'water heater', '水': 'water',
    # injury and illness
    '応急手当': 'first aid', '応急処置': 'first aid', '救急': 'emergency', 'けが': 'injury', '怪我': 'injury', 'ケガ': 'injury',
    '切り傷': 'cut', '傷口': 'wound', '傷': 'wound', '出血': 'bleeding', '止血': 'bleeding', '血': 'bleeding',
    'やけど': 'burn', '火傷': 'burn', '骨折': 'fracture', '捻挫': 'sprain', 'ねんざ': 'sprain', '打撲': 'bruise',
    '心肺蘇生': 'cpr', '人工呼吸': 'rescue breathing', '心臓マッサージ': 'chest compressions', 'AED': 'defibrillator',
    '心臓発作': 'heart attack', '胸の痛み': 'chest pain', '窒息': 'choking', '喉に詰まった': 'choking',
    '意識がない': 'unconscious', '意識不明': 'unconscious', '気絶': 'fainting', '失神': 'fainting', '呼吸': 'breathing',
    '回復体位': 'recovery position', 'ショック': 'shock', '熱中症': 'heat stroke', '低体温症': 'hypothermia', '低体温': 'hypothermia',
    '凍傷': 'frostbite', '発熱': 'fever', '熱': 'fever', '下痢': 'diarrhea', '脱水': 'dehydration', '嘔吐': 'vomiting', '吐き気': 'nausea',
    '感染症': 'infection', '感染': 'infection', '化膿': 'infection', 'アレルギー': 'allergic', 'アナフィラキシー': 'anaphylaxis',
    '噛まれた': 'bite', '咬傷': 'bite', '蛇': 'snake', 'ヘビ': 'snake', '虫刺され': 'sting', '刺された': 'sting', '刺され': 'sting', '蜂': 'bee sting', 'ハチ': 'bee sting',
    '薬': 'medicine', '鎮痛剤': 'painkiller', '痛み止め': 'painkiller', '抗生物質': 'antibiotics', '包帯': 'bandage', '添え木': 'splint',
    '歯': 'teeth', '妊娠': 'pregnant', '出産': 'birth', '赤ちゃん': 'baby', '乳児': 'infant', '子ども': 'child', '子供': 'child',
    '高齢者': 'elderly', 'お年寄り': 'elderly', 'ストレス': 'stress', '不安': 'anxiety', 'うつ': 'depression', '病気': 'illness',
    '一酸化炭素': 'carbon monoxide', '中毒': 'poisoning', '目': 'eye', '頭のけが': 'head injury',
    # power, light, communication
    '停電': 'blackout', '電気': 'electricity', '電力': 'power', '発電機': 'generator', '太陽光': 'solar', 'ソーラー': 'solar',
    '電池': 'battery', 'バッテリー': 'battery', '充電': 'charging', 'モバイルバッテリー': 'power bank', '懐中電灯': 'flashlight',
    'ランタン': 'lantern', 'ろうそく': 'candle', '照明': 'lighting', 'ラジオ': 'radio', 'アマチュア無線': 'amateur radio', '無線': 'radio',
    '携帯電話': 'cell phone', 'スマホ': 'phone', '電話': 'phone', '地図': 'map', 'コンパス': 'compass', '方位磁針': 'compass',
    '道に迷った': 'lost', '避難所': 'shelter', '避難': 'evacuation',
    # food
    '食べ物': 'food', '食料': 'food', '食品': 'food', '非常食': 'emergency food', '備蓄': 'storage', '料理': 'cooking',
    '調理': 'cooking', 'コンロ': 'stove', 'カセットコンロ': 'stove', '冷蔵庫': 'fridge', '冷凍庫': 'freezer', '腐った': 'spoiled',
    '食中毒': 'food poisoning', '缶詰': 'canned', '瓶詰め': 'canning', '保存食': 'preserve', '保存': 'preserve', '漬物': 'pickle',
    '乾燥': 'drying', '燻製': 'smoking', '塩漬け': 'salting', '米': 'rice', '小麦': 'wheat', '豆': 'beans', '粉ミルク': 'infant formula',
    # heat, cold, shelter
    '寒さ': 'cold', '寒い': 'cold', '暑さ': 'heat', '暑い': 'heat', '暖房': 'heating', '断熱': 'insulation', 'テント': 'tent',
    'ブルーシート': 'tarp', '寝袋': 'sleeping bag', '毛布': 'blanket', '焚き火': 'fire', '火起こし': 'fire starting',
    # sanitation
    'トイレ': 'toilet', '簡易トイレ': 'emergency toilet', '非常用トイレ': 'emergency toilet', '排泄物': 'excreta', '下水': 'sewage',
    'ゴミ': 'garbage', 'ごみ': 'garbage', '手洗い': 'handwashing', '衛生': 'hygiene', '石けん': 'soap', '石鹸': 'soap',
    'カビ': 'mold', 'ネズミ': 'rats', '蚊': 'mosquito', 'ハエ': 'flies',
    # disasters
    '地震': 'earthquake', '津波': 'tsunami', '洪水': 'flood', '浸水': 'flood', '水害': 'flood', '台風': 'hurricane', '竜巻': 'tornado',
    '火事': 'fire', '火災': 'fire', '山火事': 'wildfire', '煙': 'smoke', '噴火': 'volcano', '火山': 'volcano', '大雪': 'winter storm',
    '雪': 'snow', '土砂崩れ': 'landslide', 'がけ崩れ': 'landslide', 'ガス漏れ': 'gas leak', 'ガス': 'gas', '放射線': 'radiation',
    '原発': 'nuclear', '放射能': 'radiation', '防災': 'preparedness', '非常持ち出し袋': 'go bag', '防災グッズ': 'emergency kit',
    # growing, animals, land
    '家庭菜園': 'vegetable garden', '菜園': 'garden', '畑': 'garden', '野菜': 'vegetable', '種': 'seeds', '種まき': 'sowing',
    '土': 'soil', '堆肥': 'compost', '肥料': 'fertilizer', 'じゃがいも': 'potato', 'ジャガイモ': 'potato', '鶏': 'chickens',
    'ニワトリ': 'chickens', 'ヤギ': 'goat', '養蜂': 'beekeeping', '家畜': 'livestock', '釣り': 'fishing', '狩猟': 'hunting',
    '野草': 'wild plants', 'きのこ': 'mushrooms', '薪': 'firewood', '木材': 'wood',
    # repair and tools
    '修理': 'repair', '直す': 'fix', '工具': 'tools', '道具': 'tools', 'エンジン': 'engine', '溶接': 'weld', 'ナイフ': 'knife',
    '研ぐ': 'sharpen', 'ロープ': 'rope', '結び方': 'knots', 'ポンプ': 'pump', '自転車': 'bicycle', '車': 'car', '大工': 'carpentry',
}

_KEYS = sorted(TERMS, key=len, reverse=True)
_LATIN = re.compile(r"[A-Za-z0-9][A-Za-z0-9'-]*")


def has_japanese(q):
    return bool(JA.search(q or ''))


def to_english(q):
    """English search words for a query with Japanese in it; the query itself when it has none.
    Returns '' when nothing in it is known, so the caller can say the library has nothing for it."""
    if not has_japanese(q):
        return q
    out, i, n = [], 0, len(q)
    while i < n:
        for k in _KEYS:
            if q.startswith(k, i):
                out.append(TERMS[k])
                i += len(k)
                break
        else:
            m = _LATIN.match(q, i)
            if m:
                out.append(m.group(0))
                i = m.end()
            else:
                i += 1
    seen, words = set(), []
    for w in out:   # one copy of each, in the order typed
        if w.lower() not in seen:
            seen.add(w.lower())
            words.append(w)
    return ' '.join(words)
