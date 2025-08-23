// src/components/EstimatorV5/EstimatorV5.tsx
// Part 1/9 - Header, Types, Fallbacks, JSON loader, State definitions only
// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useState } from "react";

/**
 * studio ate | 見積りウィジェット V5
 * -------------------------------------------------
 * 目的：
 * - 価格/文言/画像/色/UI挙動/計算ルールを 100% 外部JSONで制御
 * - ニューボーンの「既存カード置き換え」・Weddingの単価式をJSON管理
 * - ハーフ成人の専用カテゴリ（男女共通キー・性別別ラベル）に対応
 * - DeepLink（plainモード）で選択内容を予約フォームへ連携
 * - 見積もり表示は「確認ボタン押下」でのみ（触れたら常にリセット＝——）
 *
 * このPartでは：型・フェイルセーフ・ローダ・初期状態を用意します
 */

/* ========== ユーティリティ ========== */
const currency = (n: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 })
    .format(Math.round(n || 0));

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const t = (s: string, vars: Record<string, any> = {}) =>
  (s || "").replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ""));

/* ========== 型（主要部分のみ。必要に応じて後続Partで拡張） ========== */
type UITheme = {
  brandName?: string;
  colors: {
    primary: string;
    primaryHover: string;
    accent: string;
    badgeBg: string;
    badgeText: string;
    ring: string;
    border: string;
    text: string;
    mutedText: string;
    bg: string;
    panelBg: string;
    danger: string;
  };
  buttons: {
    reserve: { bg: string | "primary"; hover: string | "primaryHover"; text: string };
    action: { bg: string | "accent"; hover: string; text: string };
  };
};

type UIConfig = {
  theme: UITheme;
  breakdown: { defaultOpen: boolean };
  calcMode: { requireEstimateConfirm: boolean; confirmButtonId: string }; // "estimateNow"
  // 追加：初期値の外部化（存在すれば優先）
  defaults?: Partial<{
    month: string;
    weekdayWeekend: "weekday" | "weekend";
    genre: string;
    support: "A" | "B" | "C";
    costume: "bring" | "inStore" | "partner";
    showAteOne: boolean;
  }>;
};

type CopyPack = {
  titles: Record<string, string>;
  buttons: Record<string, string>;
  labels: Record<string, string>;
};

type MissingHints = {
  weekdayWeekend: string;
  month: string;
  genre: string;
  support: string;
  costume: string;
  partnerCategory: string;
  partnerRank: string;
};

type CalcRules = {
  featureRules: { westernAddOnEligibleGenres: string[] };
  preparedArrival: {
    enabled: boolean;
    mode: "flat" | "age-tiered";
    flatAmount?: number;
    byGenre?: Record<string, number>;
    excludedGenres?: string[];
  };
  discountEligibleGenres: string[];
  supportAForcesBring: boolean;
  resetOnGenreChange: {
    clearFamilyIfHidden: boolean;
    clearVisitIfNotOmiya: boolean;
    clearSiblingIfNot753: boolean;
    resetPartnerIfNotAllowed: boolean;
  };
  minTotal: number;
};

type DeepLinkConfig = {
  reserveFormUrl: string;
  queryParam: string; // "quote"
  includeKeys: string[];
  mode?: "plain"; // 将来 "lz-base64" 等を追加予定
};

type Delivery = { sameDayPrice: number; rushPrice: number; busyMonths: number[] };

type Participants = {
  included: number;
  extra: { adultOrHS: number; childU15: number; dog: number };
  semiMain: { person: number; dog: number };
};

type AdultDressing = { dressOnly: number; dressHair: number };

type AddOns = {
  sibling753: number;
  location: number;
  visitRental753: number;
  omiyaVisitRentalBaby: number;
  omiyaVisitRentalAdult: number;
  nihongami: number;
  hairChange: number;
  westernAddOnFrom: number; // 別名：westernOutfitFrom を後方互換で吸収
};

type BaseFees = {
  ateOne: number;
  ateCollection: number;
  legacy: Record<"bronze" | "silver" | "gold" | "platinum" | "diamond", number>;
};

type PlanMeta = { key: string; name: string; badge?: string; note?: string; image?: string };

type Durations = Record<string, { shoot: string; stay: string }>;

type GenreAddonEntry = { label: string; A: number | null; B: number | null; C: number | null };
type GenreAddons = Record<string, GenreAddonEntry>;

type Costumes = {
  bring: { label: string; price: number };
  inStore: { label: string; price: number };
  partner: {
    label: string;
    // 主役のジャンル→提携カテゴリ
    rentalCategoryByGenre: Record<string, string[]>;
    // 性別別の表示名（ハーフ専用カテゴリは性別別ラベルをここで定義）
    categoryDisplayNames?: Record<
      string,
      | string
      | { ["half-girl"]?: string; ["half-boy"]?: string; [k: string]: string | undefined }
    >;
    // 家族衣装の性別→許可カテゴリ
    familyGenderCategoryMap?: { female: string[]; male: string[] };
    // 提携レンタル価格表（ランク→金額）
    rentalPrices: Record<string, Record<string, number>>;
  };
};

type ImagesConfig = {
  genres?: Record<string, string>;
  plans?: Record<string, string>;
};

type PlanBadges = Record<string, string>;
type OptionDiscountBlurb = Record<string, string>;

// Wedding 専用設定
type WeddingConfig = {
  enabled: boolean;
  expectedPhotos: number;
  minutesPerPhoto: number;
  costPerMinute: number;
  contentsExpectedCounts?: Record<string, number>; // 例：{ "panelS":2, "panelM":3, "bookM10":20 }
};

// ジャンル別のプラン置き換え/非表示設定（Newborn 等）
type GenrePlanOverride = {
  // プラン表示は既存のキー構成を維持しつつ、名前/バッジ/注記/画像/基礎料金を上書き可能
  planOverrides?: Record<
    string,
    Partial<PlanMeta> & { baseFeeOverride?: number } // baseFeeOverride で価格置換
  >;
  hidePlanKeys?: string[]; // 正規表現文字列も許容（"legacy.*" 等）…実装側でマッチ評価
};

type SchemaV5 = {
  schemaVersion: 4 | 5; // 後方互換のため4も許容
  colors: {
    primary: string; primaryHover: string; accent: string; badgeBg: string; badgeText: string;
    ring: string; border: string; cardBg: string; text: string; muted: string; bodyBg: string; borderActive: string;
  };

  ui: UIConfig;
  copy: CopyPack;
  missingHints: MissingHints;

  calcRules: CalcRules;
  deepLink: DeepLinkConfig;

  planBadges?: PlanBadges;
  optionDiscountBlurb?: OptionDiscountBlurb;

  delivery: Delivery;
  participants: Participants;
  adultDressing: AdultDressing;
  addOns: AddOns;
  baseFees: BaseFees;

  plans: PlanMeta[];
  durations: Durations;
  genreAddons: GenreAddons;

  costumes: Costumes;
  lpLinks?: Record<string, string>;
  images?: ImagesConfig;

  // Wedding / Newborn 拡張
  wedding?: WeddingConfig;
  genrePlanOverrides?: Record<string, GenrePlanOverride>;

  // 予約導線（従来の lineUrl の代替。未設定時は従来 lineUrl を使ってもOK）
  reserveUrl?: string;
  lineUrl?: string; // 後方互換
};

/* ========== フェイルセーフ（FALLBACK） ========== */
const DEFAULT_THEME = {
  primary: "#74151d",
  primaryHover: "#623e4c",
  accent: "#06C755",
  badgeBg: "#F3E9DD",
  badgeText: "#7A5C3E",
  ring: "#EADBC8",
  border: "#E5E7EB",
  borderActive: "#B68C69",
  cardBg: "#FFFFFF",
  text: "#111827",
  muted: "#6B7280",
  bodyBg: "#FFFFFF",
};

const FALLBACK_COPY: CopyPack = {
  titles: {
    widgetHeading: "見積り（V5 / 外部JSON）",
    intro: "撮影日 → ジャンル → サポート → 衣装 → オプションを選び、【この内容で見積もり】を押すと金額が計算されます。",
    stepDate: "① 撮影日を選ぶ",
    stepGenre: "② ジャンル/年齢を選ぶ",
    stepSupport: "③ 主役の着付け/ヘアメイクを選ぶ",
    stepCostume: "④ 主役の衣装（持ち込み／店内／提携）",
    simHeading: "料金シミュレーション（プラン別）",
    familyBlock: "ご家族の衣装を追加（任意）",
    extrasBlock: "同行者・準主役の追加（任意）",
    microBlock: "その他オプション（任意）",
  },
  buttons: {
    add: "＋ 追加",
    delete: "削除",
    reserve: "この内容で予約する",
    reload: "再読み込み",
    estimateNow: "この内容で見積もり",
  },
  labels: {
    weekday: "平日",
    weekend: "土日祝",
    supportA: "仕上がり来店（美容なし）",
    supportAHelp: "お支度済みでご来店 → 割引適用",
    supportB: "着付け＆ヘアセット込み",
    supportBHelp: "所要時間が増えます",
    supportC: "着替えのみ",
    supportCHelp: "店内でお着替えのみ",
    costumeBring: "持ち込み",
    costumeInStore: "店内衣装を利用",
    costumePartner: "提携衣装サイトからレンタル",
    partnerPickCategory: "提携衣装ジャンルを選択",
    partnerPickRank: "ランクを選択",
    partnerRankNote: "※ 提携衣装サイトのランク表記に準拠",
    familyGenderFemale: "女性",
    familyGenderMale: "男性",
    familySourceBring: "持ち込み",
    familySourcePartner: "提携衣装サイトからレンタル",
    familyDressOnly: "着付けのみ（{price}）",
    familyDressHair: "着付け＆ヘアセット（{price}）",
    familyPartnerCategory: "衣装ジャンル",
    familyPartnerRank: "ランク",
    familySubtotal: "小計：{price}",
    familyTotal: "ご家族衣装 合計：{price}",
    extrasNoteBase: "※ 基本価格には3名（父・母・主役）を含みます。",
    extraAdult: "同行者（高校生以上）",
    extraChild: "同行者（中学生以下）",
    extraDog: "同行者（ペット（わんちゃん等））",
    semiPerson: "準主役（一人写し・1ポーズ）",
    semiDog: "準主役（ペット・1ポーズ）",
    showAteOne: "初回利用または家族写真または男性成人（アテワンを表示）",
    sameDay: "即日データ納品希望（{price}）",
    sameDayNoteBusy: "（繁忙期の土日祝は不可）",
    sameDayNoteAteOne: "（アテワン対象外）",
    rush: "翌営業日データ納品希望（繁忙期土日祝専用・{price}）",
    legacyFree: "レガシープラン限定特典・即日データ納品無料（繁忙期は平日のみ適用可能）",
    location: "ロケ撮影追加(松原神社)（+{price}）",
    visit753: "当日お参りお出かけレンタル（+{price}）",
    visitOmiya: "お参りレンタル（提携衣装レンタル時のみ／産着 +{baby}・大人1名 +{adult}）",
    sibling753: "七五三 きょうだいプラン（+{price}）",
    nihongami: "日本髪（+{price}）",
    hairChange: "ヘアチェンジ（+{price}）",
    westernAddOn: "洋装追加オプション（{price}〜）",
    planTaxNote: "（税込・目安）",
    shootTime: "撮影時間",
    stayTime: "店舗滞在時間",
    breakdownTitle: "料金内訳（選択内容つき）",
    breakdownBase: "プラン料金",
    breakdownGenre: "ジャンル別加算",
    breakdownCostume: "衣装（主役）",
    breakdownFamily: "ご家族の衣装",
    breakdownSameDay: "データ納品（即日）",
    breakdownRush: "データ納品（翌営業日）",
    breakdownLocation: "ロケ撮影",
    breakdownSibling: "七五三 きょうだいプラン",
    breakdownVisit753: "七五三 お参りレンタル",
    breakdownVisitOmiya: "お宮参り 産着レンタル",
    breakdownMicro: "その他オプション",
    breakdownPrepared: "仕上がり来店割引",
    genreDetailLink: "▶︎ このジャンルの詳しいご案内",
    adminSource: "pricing source: ",
    estimateNotice: "※ 本ウィジェットの見積りは目安です。詳細はご来店時にご案内します。",
  },
};

// 後方互換のため schemaVersion:4 を継承しつつ、V5拡張を含む
const DEFAULT_PRICING_V5: SchemaV5 = {
  schemaVersion: 5,
  colors: {
    ...DEFAULT_THEME,
  },
  ui: {
    theme: {
      brandName: "studio ate",
      colors: {
        primary: "#74151d",
        primaryHover: "#623e4c",
        accent: "#06C755",
        badgeBg: "#F3E9DD",
        badgeText: "#7A5C3E",
        ring: "#EADBC8",
        border: "#E5E7EB",
        text: "#111827",
        mutedText: "#6B7280",
        bg: "#FFFFFF",
        panelBg: "#F9FAFB",
        danger: "#DC2626",
      },
      buttons: {
        reserve: { bg: "primary", hover: "primaryHover", text: "#FFFFFF" },
        action: { bg: "accent", hover: "#05B54D", text: "#FFFFFF" },
      },
    },
    breakdown: { defaultOpen: false },
    calcMode: { requireEstimateConfirm: true, confirmButtonId: "estimateNow" },
  },
  copy: FALLBACK_COPY,
  missingHints: {
    weekdayWeekend: "平日/土日祝を選択してください。",
    month: "撮影月を選択してください。",
    genre: "ジャンルを選択してください。",
    support: "お支度（仕上がり/着付け＆ヘア/着替えのみ）を選択してください。",
    costume: "主役の衣装（持ち込み／店内／提携）を選択してください。",
    partnerCategory: "提携衣装のジャンルを選んでください。",
    partnerRank: "提携衣装のランクを選んでください。"
  },
  calcRules: {
    featureRules: { westernAddOnEligibleGenres: ["omiya", "753-3", "753-5", "753-7"] },
    preparedArrival: {
      enabled: true,
      mode: "age-tiered",
      byGenre: { "753-3": 0, "753-5": 0, "753-7": 3300, "half-girl": 0, "half-boy": 0, "adult-female": 0, "adult-male": 0 },
      excludedGenres: ["omiya"],
    },
    discountEligibleGenres: ["753-3","753-5","753-7","half-girl","half-boy","adult-female","adult-male"],
    supportAForcesBring: true,
    resetOnGenreChange: {
      clearFamilyIfHidden: true,
      clearVisitIfNotOmiya: true,
      clearSiblingIfNot753: true,
      resetPartnerIfNotAllowed: true
    },
    minTotal: 0
  },
  deepLink: {
    reserveFormUrl: "https://studio-ate.jp/reserve",
    queryParam: "quote",
    includeKeys: [
      "plan","genre","support","costume","partnerCategory","partnerRank",
      "month","weekdayWeekend","sameDayData","rushNextDay",
      "locationAddOn","sibling753","visitRental",
      "extras","familyOutfits","micro","westernAddOn"
    ],
    mode: "plain"
  },
  planBadges: {
    "ateOne": "初回限定お試し！",
    "ateCollection": "気軽に！",
    "legacy.bronze": "2,740円お得・人気のパネル！",
    "legacy.silver": "6,507円お得・お手軽ブック！",
    "legacy.gold": "10,639円お得・一番人気！",
    "legacy.platinum": "15,143円お得・どっちもプラン！",
    "legacy.diamond": "21,554円お得・豪華特典！"
  },
  optionDiscountBlurb: {
    "ateOne": "",
    "ateCollection": "オプション購入で割引あり（固定文言／率は後日更新）",
    "legacy.bronze": "オプション購入でさらにお得（固定文言）",
    "legacy.silver": "オプション購入でさらにお得（固定文言）",
    "legacy.gold": "オプション購入でさらにお得（固定文言）",
    "legacy.platinum": "オプション購入でさらにお得（固定文言）",
    "legacy.diamond": "オプション購入でさらにお得（固定文言）"
  },
  delivery: { sameDayPrice: 5500, rushPrice: 5500, busyMonths: [10,11,12] },
  participants: { included: 3, extra: { adultOrHS: 550, childU15: 1650, dog: 3850 }, semiMain: { person: 3850, dog: 6050 } },
  adultDressing: { dressOnly: 11000, dressHair: 16500 },
  addOns: {
    sibling753: 33000, location: 6600, visitRental753: 8140, omiyaVisitRentalBaby: 3850, omiyaVisitRentalAdult: 3850,
    nihongami: 5500, hairChange: 3300, westernAddOnFrom: 4950,
  },
  baseFees: {
    ateOne: 16500,
    ateCollection: 29800,
    legacy: { bronze: 52060, silver: 72496, gold: 95850, platinum: 111144, diamond: 140930 }
  },
  plans: [
    { key: "ateOne", name: "アテワン", badge: "初回限定お試し！", note: "商品単品（お試し）" },
    { key: "ateCollection", name: "アテコレクション", badge: "気軽に！", note: "全データ50枚" },
    { key: "legacy.bronze", name: "レガシー｜ブロンズ", badge: "2,740円お得・人気のパネル！", note: "全データ100枚+Sパネル／5%OFF" },
    { key: "legacy.silver", name: "レガシー｜シルバー", badge: "6,507円お得・お手軽ブック！", note: "全データ100枚+Sブック6P／8%OFF" },
    { key: "legacy.gold", name: "レガシー｜ゴールド", badge: "10,639円お得・一番人気！", note: "全データ100枚+Mブック10P+ゴールド特典／10%OFF" },
    { key: "legacy.platinum", name: "レガシー｜プラチナ", badge: "15,143円お得・どっちもプラン！", note: "Sパネル+Mブック10P+プラチナ特典／12%OFF" },
    { key: "legacy.diamond", name: "レガシー｜ダイヤモンド", badge: "21,554円お得・豪華特典！", note: "Mパネル+Mブック14P+ミニブック2冊+ダイヤモンド特典／15%OFF" }
  ],
  durations: {
    ateOne: { shoot: "20分", stay: "約60分" },
    ateCollection: { shoot: "30分", stay: "約60分" },
    "legacy.bronze": { shoot: "45–60分", stay: "約120–180分" },
    "legacy.silver": { shoot: "45–60分", stay: "約120–180分" },
    "legacy.gold": { shoot: "45–60分", stay: "約120–180分" },
    "legacy.platinum": { shoot: "45–60分", stay: "約120–180分" },
    "legacy.diamond": { shoot: "45–60分", stay: "約120–180分" }
  },
  genreAddons: {
    maternity: { label: "マタニティ", A: null, B: null, C: -5000 },
    newborn:   { label: "ニューボーン", A: null, B: null, C: null },
    omiya:     { label: "お宮参り", A: null, B: null, C: 19800 },
    baby611:   { label: "ハーフ/1歳バースデー", A: null, B: null, C: 0 },
    age2:      { label: "2歳バースデー", A: null, B: null, C: 5500 },
    kinder:    { label: "入園・卒園記念", A: 6600, B: null, C: null },
    school:    { label: "入学・卒業記念", A: 6600, B: null, C: null },
    family:    { label: "家族写真", A: 13200, B: null, C: null },
    pet:       { label: "ペット（わんちゃん等）", A: 13200, B: null, C: null },
    "753-3":   { label: "七五三 3歳", A: 8800,  B: 11000, C: null },
    "753-5":   { label: "七五三 5歳", A: 16800, B: 19800, C: null },
    "753-7":   { label: "七五三 7歳", A: 14300, B: 27500, C: null },
    "half-girl": { label: "ハーフ成人 女の子", A: 6600, B: 27500, C: null },
    "half-boy":  { label: "ハーフ成人 男の子", A: 6600, B: 9900,  C: null },
    "adult-female": { label: "成人記念 女性", A: 16500, B: 33000, C: null },
    "adult-male":   { label: "成人記念 男性", A: 6600,  B: 9900,  C: null }
  },
  costumes: {
    bring:   { label: "衣装持ち込み", price: 0 },
    inStore: { label: "店内衣装を利用", price: 1650 },
    partner: {
      label: "提携衣装サイトからレンタル",
      rentalCategoryByGenre: {
        omiya: ["omiya_ubugi","adult_female_homon","adult_male_ensemble","adult_female_kurotome"],
        family: ["adult_female_homon","adult_male_ensemble","adult_female_kurotome"],
        "753-3": ["753_3_hifu"],
        "753-5": ["753_5_hakama","753_5_shoken_hakama"],
        "753-7": ["753_7_yotsumi"],
        "half-girl": ["half_furisode_hakama"],
        "half-boy": ["half_furisode_hakama"],
        "adult-female": ["seijin_female_furisode"],
        "adult-male": ["seijin_male_hakama"]
      },
      categoryDisplayNames: {
        omiya_ubugi: "お宮参り（産着）",
        adult_female_homon: "大人女性（訪問着・付下げ）",
        adult_male_ensemble: "大人男性（アンサンブル）",
        adult_female_kurotome: "大人女性（黒留袖）",
        "753_3_hifu": "七五三3歳（被布）",
        "753_5_hakama": "七五三5歳（羽織袴）",
        "753_5_shoken_hakama": "七五三5歳（正絹・羽織袴）",
        "753_7_yotsumi": "七五三7歳（四つ身）",
        seijin_female_furisode: "成人女性（振袖）",
        seijin_male_hakama: "成人男性（羽織袴）",
        half_furisode_hakama: {
          "half-girl": "女児ハーフ成人ジュニア着物（袴/振袖）",
          "half-boy":  "男児ハーフ成人ジュニア着物（袴）"
        }
      },
      familyGenderCategoryMap: {
        female: ["adult_female_homon","adult_female_kurotome"],
        male:   ["adult_male_ensemble"]
      },
      rentalPrices: {
        // 既存の価格表（省略なく記載）…ユーザー提供JSONと一致
        "omiya_ubugi": { "A": 5900, "B": 7400, "C": 8400, "D": 11400, "E": 14900, "F": 19400, "G": 29400, "H": 35900, "I": 43900 },
        "adult_female_homon": { "A": 14900, "B": 22400, "C": 29400, "D": 35900, "E": 43900 },
        "adult_male_ensemble": { "A": 22400, "B": 29400 },
        "adult_female_kurotome": { "A": 16900, "B": 21900, "C": 29900, "D": 33900, "E": 36900, "F": 49900, "G": 64900 },
        "753_3_hifu": { "A": 8900, "B": 9900, "C": 11900, "D": 12900, "E": 14900, "F": 16900, "G": 18900, "H": 21900, "I": 24900, "J": 33900 },
        "753_5_hakama": { "A": 8900, "B": 9900, "C": 11900, "D": 12900, "E": 14900, "F": 16900, "G": 18900, "H": 21900 },
        "753_5_shoken_hakama": { "F": 16900, "G": 18900, "H": 21900, "I": 24900, "J": 33900, "K": 36900, "L": 40900, "M": 49900, "N": 57900, "O": 64900, "P": 83900 },
        "753_7_yotsumi": { "A": 8900, "B": 9900, "C": 11900, "D": 12900, "E": 14900, "F": 16900, "G": 18900, "H": 21900, "I": 24900, "J": 33900, "K": 36900, "L": 40900, "M": 49900, "N": 57900, "O": 64900, "P": 83900 },
        "seijin_female_furisode": { "A": 16900, "B": 21900, "C": 24900, "D": 29900, "E": 33900, "F": 40900, "G": 49900, "H": 57900, "I": 66900 },
        "seijin_male_hakama": { "A": 16900, "B": 24900, "C": 33900, "D": 40900, "E": 49900, "F": 83900, "G": 101900, "H": 129900, "I": 166900 },
        // ハーフ専用カテゴリ（男女共通キー）
        "half_furisode_hakama": { "A": 16900, "B": 21900, "C": 24900, "D": 29900, "E": 33900, "F": 40900, "G": 49900 }
      }
    }
  },
  lpLinks: {},
  images: {},
  wedding: {
    enabled: true,
    expectedPhotos: 30,
    minutesPerPhoto: 8,
    costPerMinute: 150,
    contentsExpectedCounts: { panelS: 2, panelM: 3, bookM10: 20 }
  },
  genrePlanOverrides: {
    // newborn: ここで既存プラン構造を維持しつつ内容/価格を後から上書きできる
    // 例）
    // newborn: {
    //   planOverrides: {
    //     "ateOne": { name: "ニューボーン｜アテワン", badge: "新生児専用", note: "安全配慮＋セレクト納品（最大30枚）", baseFeeOverride: 18000 },
    //     "ateCollection": { name: "ニューボーン｜アテコレ", badge: "新生児専用", note: "セレクト納品（最大50枚）", baseFeeOverride: 32000 },
    //   }
    // }
  },
  reserveUrl: "https://studio-ate.jp/reserve",
  lineUrl: "https://lin.ee/0gs9tlY" // 後方互換
};

/* ========== JSON ロード（SSR安全） ========== */
async function loadPricingJSON(signal: AbortSignal): Promise<SchemaV5> {
  try {
    let url = "/ate-pricingV5.json";
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("pricing");
      if (p) url = p;
    }
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("invalid json");
    // 型は緩やかに受け、deepMergeで後方互換を担保
    // 最低限の健全性チェック（空オブジェクトはNG扱い）
if (Object.keys(data || {}).length === 0) {
  console.warn("[pricing] empty JSON object received. Using DEFAULT_PRICING_V5 fallback.");
  throw new Error("empty json");
}
return data;
  } catch (e) {
    console.warn("[pricing] fallback to DEFAULT_PRICING_V5", e);
    return DEFAULT_PRICING_V5;
  }
}

/* ========== Deep Merge（nullは消す、undefinedは据え置き） ========== */
/**
 * deepMerge
 * - 配列は「上書き」
 * - null は「消す（srcの意図を尊重）」
 * - undefined は「据え置き（baseを維持）」
 * - オブジェクトは再帰マージ
 */
function deepMerge(base: any, src: any) {
  if (src === null) return null;
  if (Array.isArray(base) || Array.isArray(src)) return src ?? base;
  if (typeof base === "object" && typeof src === "object" && base && src) {
    const out: any = { ...base };
    const keys = new Set([...Object.keys(base), ...Object.keys(src)]);
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = deepMerge(base[k], src[k]);
      else out[k] = base[k];
    }
    return out;
  }
  return src !== undefined ? src : base;
}

/* ========== メイン（このPartは状態定義まで） ========== */
export default function EstimatorV5() {
  // 設定ロード
  const [pricing, setPricing] = useState<SchemaV5>(DEFAULT_PRICING_V5);
  const [source, setSource] = useState<"default" | "json">("default");

  // UIステップ
  const [step, setStep] = useState<number>(1);

  // 日付関連
  const [month, setMonth] = useState<string>("9");
  const [weekdayWeekend, setWeekdayWeekend] = useState<"weekday" | "weekend">("weekday");

  // ジャンル・サポート
  const [genre, setGenre] = useState<string>("753-3");
  const [support, setSupport] = useState<"A" | "B" | "C">("A");

  // 衣装（主役）
  const [costume, setCostume] = useState<"bring" | "inStore" | "partner">("bring");
  const [partnerCategory, setPartnerCategory] = useState<string | null>(null);
  const [partnerRank, setPartnerRank] = useState<string | null>(null);

  // 表示フラグ
  const [showAteOne, setShowAteOne] = useState<boolean>(false);

  // データ納品
  const [sameDayData, setSameDayData] = useState<boolean>(false);
  const [rushNextDay, setRushNextDay] = useState<boolean>(false);

  // アドオン
  const [locationAddOn, setLocationAddOn] = useState<boolean>(false);
  const [sibling753, setSibling753] = useState<boolean>(false);
  const [visitRental, setVisitRental] = useState<boolean>(false);

  // micro
  const [optNihongami, setOptNihongami] = useState<boolean>(false);
  const [optHairChange, setOptHairChange] = useState<boolean>(false);
  const [optWesternWear, setOptWesternWear] = useState<boolean>(false);

  // 同行者/準主役
  const [extras, setExtras] = useState({ adult: 0, child: 0, dog: 0, semiPerson: 0, semiDog: 0 });

  // 家族衣装
  const [familyOutfits, setFamilyOutfits] = useState<
    { id: number; gender: "female" | "male"; source: "bring" | "partner"; dressing: "dressOnly" | "dressHair"; category: string | null; rank: string | null }[]
  >([]);

  // 見積り表示フラグ（「この内容で見積もり」を押したら true。どこか触ったら false に戻す）
  const [estimated, setEstimated] = useState<boolean>(false);
  const [validationMsg, setValidationMsg] = useState<string>("");

  // テーマ（CSS変数用）
  const colors = useMemo(() => ({ ...DEFAULT_THEME, ...(pricing.colors || {}) }), [pricing]);
  const CP = useMemo<CopyPack>(() => {
    const src = pricing.copy || FALLBACK_COPY;
    return {
      titles: { ...FALLBACK_COPY.titles, ...(src.titles || {}) },
      buttons: { ...FALLBACK_COPY.buttons, ...(src.buttons || {}) },
      labels: { ...FALLBACK_COPY.labels, ...(src.labels || {}) },
    };
  }, [pricing]);

  // 初回ロード
  useEffect(() => {
    const ac = new AbortController();
    loadPricingJSON(ac.signal).then((data) => {
  const merged = deepMerge(DEFAULT_PRICING_V5, data);

  // スキーマ警告（許容はするが気づけるように）
  if (merged?.schemaVersion !== 5) {
    console.warn(
      `[pricing] schemaVersion is ${merged?.schemaVersion} (expected 5). Falling back to compatibility mode.`
    );
  }

  setPricing(merged);
  setSource(data === DEFAULT_PRICING_V5 ? "default" : "json");
});
    return () => ac.abort();
  }, []);
// 初回ロード時に ui.defaults があれば初期値を上書き
const d = merged?.ui?.defaults || {};
if (d.month) setMonth(String(d.month));
if (d.weekdayWeekend) setWeekdayWeekend(d.weekdayWeekend);
if (d.genre) setGenre(d.genre);
if (d.support) setSupport(d.support);
if (d.costume) setCostume(d.costume);
if (typeof d.showAteOne === "boolean") setShowAteOne(d.showAteOne);
  // この先（Part 2〜）：選択肢生成・バリデーション・計算・UI描画を実装
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6" style={{ background: colors.bodyBg, color: colors.text }}>
      <h2 className="text-2xl md:text-3xl font-bold">{CP.titles.widgetHeading}</h2>
      <p className="mt-1 text-sm md:text-base" style={{ color: mutedColor }}>
        {CP.titles.intro}
      </p>
      <div className="mt-4 text-xs" style={{ color: mutedColor }}>
        <span className="inline-block px-2 py-1 rounded" style={{ background: "#f3f4f6" }}>
          {CP.labels.adminSource}{source}
        </span>
      </div>

      {/* Part 2 以降でステップUIや計算UIを追加します */}
    </div>
  );
}
