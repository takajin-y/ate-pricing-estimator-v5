// src/components/EstimatorV5/EstimatorV5.tsx
// Part 1–3 完成版（Header, Types, Fallbacks, JSON loader, State + 画面ステップ1〜4まで）
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
 * このファイルは Part1〜3 を統合した作業用安定版です。
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
  calcMode: { requireEstimateConfirm: boolean; confirmButtonId: string };
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
    rentalCategoryByGenre: Record<string, string[]>;
    categoryDisplayNames?: Record<
      string,
      | string
      | { ["half-girl"]?: string; ["half-boy"]?: string; [k: string]: string | undefined }
    >;
    familyGenderCategoryMap?: { female: string[]; male: string[] };
    rentalPrices: Record<string, Record<string, number>>;
  };
};

type ImagesConfig = {
  genres?: Record<string, string>;
  plans?: Record<string, string>;
};

type PlanBadges = Record<string, string>;
type OptionDiscountBlurb = Record<string, string>;

type WeddingConfig = {
  enabled: boolean;
  expectedPhotos: number;
  minutesPerPhoto: number;
  costPerMinute: number;
  contentsExpectedCounts?: Record<string, number>;
};

type GenrePlanOverride = {
  planOverrides?: Record<
    string,
    Partial<PlanMeta> & { baseFeeOverride?: number }
  >;
  hidePlanKeys?: string[]; // 正規表現文字列を許容（実装側で評価）
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

  wedding?: WeddingConfig;
  genrePlanOverrides?: Record<string, GenrePlanOverride>;

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

// 後方互換のため schemaVersion:4 を許容しつつ、初期値は 5
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
        // ハーフ専用カテゴリ（男女共通キーだが性別別ラベルを上書き表示）
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
    // newborn: { planOverrides: { ... } } を後でJSON側から自由に差し替え
  },
  reserveUrl: "https://studio-ate.jp/reserve",
  lineUrl: "https://lin.ee/0gs9tlY"
};

/* ========== JSON ロード（SSR安全） ========== */
async function loadPricingJSON(signal: AbortSignal): Promise<SchemaV5> {
  try {
    let url = "/ate-pricingV5.json"; // ← V4 ではなく V5 を既定に
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("pricing");
      if (p) url = p;
    }
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("invalid json");
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

/* ========== メイン（Part1: 状態定義 / Part2–3: UI・バリデーション） ========== */
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
  const mutedColor = colors.muted;
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
    loadPricingJSON(ac.signal)
      .then((data) => {
        const merged = deepMerge(DEFAULT_PRICING_V5, data);

        // スキーマ注意（許容）
        if (merged?.schemaVersion !== 5) {
          console.warn(`[pricing] schemaVersion is ${merged?.schemaVersion} (expected 5). Compatibility mode.`);
        }

        setPricing(merged);
        setSource(data === DEFAULT_PRICING_V5 ? "default" : "json");

        // ui.defaults を初期値に反映
        const d = merged?.ui?.defaults || {};
        if (d.month != null) setMonth(String(d.month));
        if (d.weekdayWeekend === "weekday" || d.weekdayWeekend === "weekend") setWeekdayWeekend(d.weekdayWeekend);
        if (typeof d.genre === "string") setGenre(d.genre);
        if (d.support === "A" || d.support === "B" || d.support === "C") setSupport(d.support);
        if (d.costume === "bring" || d.costume === "inStore" || d.costume === "partner") setCostume(d.costume);
        if (typeof d.showAteOne === "boolean") setShowAteOne(d.showAteOne);
      })
      .catch((e) => {
        console.warn("[pricing] load failed; using default", e);
        setPricing(DEFAULT_PRICING_V5);
        setSource("default");
      });
    return () => ac.abort();
  }, []);

  /* ========== Part 2: 派生状態・ユーティリティ・バリデーション ========== */

  // 繁忙期かどうか
  const isBusyMonth = useMemo(() => {
    const m = Number(month);
    return Array.isArray(pricing?.delivery?.busyMonths) && pricing.delivery.busyMonths.includes(m);
  }, [month, pricing]);

  // 即日/翌営業日の可否（表示はグレーアウトで、非表示にはしない）
  const sameDayAllowed = useMemo(() => {
    if (isBusyMonth && weekdayWeekend === "weekend") return false;
    return true;
  }, [isBusyMonth, weekdayWeekend]);

  const rushNextDayAllowed = useMemo(() => {
    return isBusyMonth && weekdayWeekend === "weekend";
  }, [isBusyMonth, weekdayWeekend]);

  // 主役衣装の「選択肢」可否（Half/Adult は inStore を出さない）
  const allowInStore = useMemo(() => {
    const g = genre;
    if (g === "half-girl" || g === "half-boy" || g === "adult-female" || g === "adult-male") return false;
    return true;
  }, [genre]);

  // supportA の場合は持ち込み強制（JSONのルールに従う）
  useEffect(() => {
    if (pricing?.calcRules?.supportAForcesBring && support === "A") {
      if (costume !== "bring") setCostume("bring");
    }
  }, [support, pricing, costume]);

  // パートナー衣装のカテゴリリスト（ジャンル別）
  const partnerCategoriesForGenre = useMemo(() => {
    const all = pricing?.costumes?.partner?.rentalCategoryByGenre || {};
    return all[genre] || [];
  }, [pricing, genre]);

  // カテゴリの表示名（ハーフは性別別ラベルあり）
  const displayCategoryName = (catKey: string) => {
    const map = pricing?.costumes?.partner?.categoryDisplayNames || {};
    const label = map[catKey];
    if (!label) return catKey;
    if (typeof label === "string") return label;
    const sexKey = genre === "half-girl" ? "half-girl" : genre === "half-boy" ? "half-boy" : undefined;
    if (sexKey && typeof label === "object") return label[sexKey] || catKey;
    return catKey;
  };

  // ランク一覧（カテゴリ→価格表のキー）
  const ranksForCategory = (catKey: string) => {
    const table = pricing?.costumes?.partner?.rentalPrices || {};
    const record = table[catKey] || {};
    return Object.keys(record); // ["A","B",...]
  };

  // 家族衣装の性別→許可カテゴリ
  const familyMap = pricing?.costumes?.partner?.familyGenderCategoryMap || {
    female: ["adult_female_homon", "adult_female_kurotome"],
    male: ["adult_male_ensemble"],
  };

  // 何かを操作したら見積もりリセット（＝「——」に戻す）
  const touch = () => {
    if (estimated) setEstimated(false);
    if (validationMsg) setValidationMsg("");
  };

  // バリデーション（最低限）
  const validateBeforeEstimate = () => {
    if (costume === "partner") {
      if (!partnerCategory) return setValidationMsg(pricing?.missingHints?.partnerCategory || "提携衣装のジャンルを選んでください。"), false;
      if (!partnerRank) return setValidationMsg(pricing?.missingHints?.partnerRank || "提携衣装のランクを選んでください。"), false;
    }
    setValidationMsg("");
    return true;
  };

  // 見積り実行（計算は Part 4 以降）
  const onEstimateNow = () => {
    if (!validateBeforeEstimate()) return;
    setEstimated(true);
  };

  // DeepLink（plainモード）…Part 8で完成予定（ここではURLパラメータ組み立て器だけ）
  const buildQuoteQuery = () => {
    const cfg = pricing?.deepLink;
    if (!cfg || cfg.mode !== "plain") return "";
    const payload: any = {};
    for (const key of cfg.includeKeys || []) {
      switch (key) {
        case "plan": break; // Part 5 で選択されたプランを詰める
        case "genre": payload.genre = genre; break;
        case "support": payload.support = support; break;
        case "costume": payload.costume = costume; break;
        case "partnerCategory": payload.partnerCategory = partnerCategory; break;
        case "partnerRank": payload.partnerRank = partnerRank; break;
        case "month": payload.month = month; break;
        case "weekdayWeekend": payload.weekdayWeekend = weekdayWeekend; break;
        case "sameDayData": payload.sameDayData = sameDayData; break;
        case "rushNextDay": payload.rushNextDay = rushNextDay; break;
        case "locationAddOn": payload.locationAddOn = locationAddOn; break;
        case "sibling753": payload.sibling753 = sibling753; break;
        case "visitRental": payload.visitRental = visitRental; break;
        case "extras": payload.extras = extras; break;
        case "familyOutfits": payload.familyOutfits = familyOutfits; break;
        case "micro": payload.micro = { nihongami: optNihongami, hairChange: optHairChange, western: optWesternWear }; break;
        case "westernAddOn": payload.westernAddOn = optWesternWear; break;
        default: break;
      }
    }
    const q = new URLSearchParams({ [cfg.queryParam || "quote"]: JSON.stringify(payload) });
    return q.toString(); // 例： "quote=%7B...%7D"
  };

  /* ========== Part 3: 画面（ステップ1〜4 + 見積ボタン + ダミー結果） ========== */
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6" style={{ background: colors.bodyBg, color: colors.text }}>
      {/* ヘッダー */}
      <h2 className="text-2xl md:text-3xl font-bold">{CP.titles.widgetHeading}</h2>
      <p className="mt-1 text-sm md:text-base" style={{ color: colors.muted }}>
        {CP.titles.intro}
      </p>
      <div className="mt-4 text-xs" style={{ color: colors.muted }}>
        <span className="inline-block px-2 py-1 rounded" style={{ background: "#f3f4f6" }}>
          {CP.labels.adminSource}{source}
        </span>
      </div>

      {/* ステップ1：撮影日 */}
      <div className="mt-6 p-4 rounded-2xl border" style={{ borderColor: colors.border, background: "#fff" }}>
        <h3 className="font-semibold text-lg">{CP.titles.stepDate}</h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1" style={{ color: mutedColor }}>撮影月</label>
            <select
              className="w-full rounded-xl border p-2"
              style={{ borderColor: colors.border }}
              value={month}
              onChange={(e) => { setMonth(e.target.value); touch(); }}
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const m = String(i + 1);
                return <option key={m} value={m}>{m}月</option>;
              })}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1" style={{ color: mutedColor }}>曜日区分</label>
            <div className="flex gap-3">
              {(["weekday", "weekend"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => { setWeekdayWeekend(k); touch(); }}
                  className={`px-3 py-2 rounded-xl border ${weekdayWeekend === k ? "ring-2" : ""}`}
                  style={{
                    borderColor: colors.border,
                    background: weekdayWeekend === k ? colors.badgeBg : "#fff",
                    color: colors.text,
                    boxShadow: weekdayWeekend === k ? `0 0 0 2px ${colors.ring}` : "none",
                  }}
                  type="button"
                >
                  {k === "weekday" ? CP.labels.weekday : CP.labels.weekend}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs" style={{ color: mutedColor }}>
              繁忙期：{(pricing?.delivery?.busyMonths || []).join("・")}月／現在は {isBusyMonth ? "繁忙期" : "通常期"}
            </div>
          </div>
        </div>
      </div>

      {/* ステップ2：ジャンル */}
      <div className="mt-6 p-4 rounded-2xl border" style={{ borderColor: colors.border, background: "#fff" }}>
        <h3 className="font-semibold text-lg">{CP.titles.stepGenre}</h3>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(pricing.genreAddons || {}).map(([k, v]) => (
            <button
              key={k}
              onClick={() => {
                setGenre(k);
                // 選択変更の副作用
                setPartnerCategory(null);
                setPartnerRank(null);
                touch();
              }}
              className={`px-3 py-2 rounded-xl border text-left ${genre === k ? "ring-2" : ""}`}
              style={{
                borderColor: colors.border,
                background: genre === k ? colors.badgeBg : "#fff",
                boxShadow: genre === k ? `0 0 0 2px ${colors.ring}` : "none",
              }}
              type="button"
              title={v?.label || k}
            >
              <div className="font-medium">{v?.label || k}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ステップ3：お支度（サポート） */}
      <div className="mt-6 p-4 rounded-2xl border" style={{ borderColor: colors.border, background: "#fff" }}>
        <h3 className="font-semibold text-lg">{CP.titles.stepSupport}</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {(["A","B","C"] as const).map((k) => {
            const titleMap: any = { A: CP.labels.supportA, B: CP.labels.supportB, C: CP.labels.supportC };
            const helpMap: any  = { A: CP.labels.supportAHelp, B: CP.labels.supportBHelp, C: CP.labels.supportCHelp };
            return (
              <button
                key={k}
                onClick={() => { setSupport(k); touch(); }}
                className={`px-3 py-2 rounded-xl border text-left ${support === k ? "ring-2" : ""}`}
                style={{
                  borderColor: colors.border,
                  background: support === k ? colors.badgeBg : "#fff",
                  boxShadow: support === k ? `0 0 0 2px ${colors.ring}` : "none",
                }}
                type="button"
                title={helpMap[k]}
              >
                <div className="font-medium">{titleMap[k]}</div>
                <div className="text-xs" style={{ color: mutedColor }}>{helpMap[k]}</div>
              </button>
            );
          })}
        </div>
        {pricing?.calcRules?.supportAForcesBring && support === "A" && (
          <div className="mt-2 text-xs" style={{ color: mutedColor }}>
            ※ {CP.labels.supportA} 選択時は主役衣装が自動的に「{CP.labels.costumeBring}」になります。
          </div>
        )}
      </div>

      {/* ステップ4：主役の衣装 */}
      <div className="mt-6 p-4 rounded-2xl border" style={{ borderColor: colors.border, background: "#fff" }}>
        <h3 className="font-semibold text-lg">{CP.titles.stepCostume}</h3>

        {/* 衣装ソース（持ち込み / 店内 / 提携） */}
        <div className="mt-3 flex flex-wrap gap-3">
          {/* bring */}
          <button
            onClick={() => { setCostume("bring"); touch(); }}
            className={`px-3 py-2 rounded-xl border ${costume === "bring" ? "ring-2" : ""}`}
            style={{
              borderColor: colors.border,
              background: costume === "bring" ? colors.badgeBg : "#fff",
              boxShadow: costume === "bring" ? `0 0 0 2px ${colors.ring}` : "none",
            }}
            type="button"
          >
            {CP.labels.costumeBring}
          </button>

          {/* inStore（Half/Adultでは選択不可。Aでも不可） */}
          <button
            onClick={() => { if (allowInStore && support !== "A") { setCostume("inStore"); touch(); } }}
            disabled={!allowInStore || support === "A"}
            className={`px-3 py-2 rounded-xl border ${costume === "inStore" ? "ring-2" : ""} ${(!allowInStore || support === "A") ? "opacity-50 cursor-not-allowed" : ""}`}
            style={{
              borderColor: colors.border,
              background: costume === "inStore" ? colors.badgeBg : "#fff",
              boxShadow: costume === "inStore" ? `0 0 0 2px ${colors.ring}` : "none",
            }}
            type="button"
            title={!allowInStore ? "このジャンルでは店内衣装は選べません" : (support === "A" ? "仕上がり来店では店内衣装は選べません" : "")}
          >
            {CP.labels.costumeInStore}
          </button>

          {/* partner */}
          <button
            onClick={() => { if (support !== "A") { setCostume("partner"); touch(); } }}
            disabled={support === "A"}
            className={`px-3 py-2 rounded-xl border ${costume === "partner" ? "ring-2" : ""} ${(support === "A") ? "opacity-50 cursor-not-allowed" : ""}`}
            style={{
              borderColor: colors.border,
              background: costume === "partner" ? colors.badgeBg : "#fff",
              boxShadow: costume === "partner" ? `0 0 0 2px ${colors.ring}` : "none",
            }}
            type="button"
          >
            {CP.labels.costumePartner}
          </button>
        </div>

        {/* 提携衣装のカテゴリ/ランク（partner選択時のみ表示） */}
        {costume === "partner" && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm mb-1" style={{ color: mutedColor }}>{CP.labels.partnerPickCategory}</div>
              <select
                className="w-full rounded-xl border p-2"
                style={{ borderColor: colors.border }}
                value={partnerCategory || ""}
                onChange={(e) => { setPartnerCategory(e.target.value || null); setPartnerRank(null); touch(); }}
              >
                <option value="">{CP.missingHints.partnerCategory}</option>
                {partnerCategoriesForGenre.map((k) => (
                  <option key={k} value={k}>{displayCategoryName(k)}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-sm mb-1 flex items-center gap-2" style={{ color: mutedColor }}>
                <span>{CP.labels.partnerPickRank}</span>
                <span className="text-xs">{CP.labels.partnerRankNote}</span>
              </div>
              <select
                className="w-full rounded-xl border p-2"
                style={{ borderColor: colors.border }}
                value={partnerRank || ""}
                onChange={(e) => { setPartnerRank(e.target.value || null); touch(); }}
                disabled={!partnerCategory}
              >
                <option value="">{CP.missingHints.partnerRank}</option>
                {(partnerCategory ? ranksForCategory(partnerCategory) : []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                    {(() => {
                      const ptable = pricing?.costumes?.partner?.rentalPrices || {};
                      const price = ptable?.[partnerCategory || ""]?.[r];
                      return typeof price === "number" ? `（${currency(price)}）` : "";
                    })()}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* データ納品（グレーアウト制御のみ・非表示にはしない） */}
      <div className="mt-6 p-4 rounded-2xl border" style={{ borderColor: colors.border, background: "#fff" }}>
        <h3 className="font-semibold text-lg">データ納品</h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 即日 */}
          <label className={`flex items-start gap-2 p-3 rounded-xl border ${!sameDayAllowed ? "opacity-50" : ""}`}
                 style={{ borderColor: colors.border }}>
            <input
              type="checkbox"
              checked={sameDayData}
              onChange={() => { setSameDayData(!sameDayData); touch(); }}
              disabled={!sameDayAllowed}
              className="mt-1"
            />
            <div>
              <div className="font-medium">{t(CP.labels.sameDay, { price: currency(pricing?.delivery?.sameDayPrice || 0) })}</div>
              <div className="text-xs" style={{ color: mutedColor }}>
                {CP.labels.sameDayNoteBusy} {CP.labels.sameDayNoteAteOne}
              </div>
            </div>
          </label>

          {/* 翌営業日（繁忙期土日祝専用） */}
          <label className={`flex items-start gap-2 p-3 rounded-xl border ${!rushNextDayAllowed ? "opacity-50" : ""}`}
                 style={{ borderColor: colors.border }}>
            <input
              type="checkbox"
              checked={rushNextDay}
              onChange={() => { setRushNextDay(!rushNextDay); touch(); }}
              disabled={!rushNextDayAllowed}
              className="mt-1"
            />
            <div>
              <div className="font-medium">{t(CP.labels.rush, { price: currency(pricing?.delivery?.rushPrice || 0) })}</div>
              <div className="text-xs" style={{ color: mutedColor }}>
                ※ 繁忙期の土日祝のみ選択可能
              </div>
            </div>
          </label>
        </div>

        {/* レガシー無料訴求 */}
        <div className="mt-3 text-xs" style={{ color: mutedColor }}>
          {CP.labels.legacyFree}
        </div>
      </div>

      {/* 見積りアクション */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          id={pricing?.ui?.calcMode?.confirmButtonId || "estimateNow"}
          onClick={onEstimateNow}
          className="px-4 py-2 rounded-xl text-white"
          style={{ background: colors.accent }}
          type="button"
        >
          {CP.buttons.estimateNow}
        </button>
        {validationMsg && (
          <span className="text-sm px-3 py-2 rounded-xl" style={{ background: "#FFF4F2", color: "#B91C1C" }}>
            {validationMsg}
          </span>
        )}
        {!estimated && (
          <span className="text-sm" style={{ color: mutedColor }}>
            ※ いずれかの項目を操作すると表示は「——」に戻ります
          </span>
        )}
      </div>

      {/* ダミーの結果表示（Part 4で計算実装予定） */}
      <div className="mt-6 p-4 rounded-2xl border" style={{ borderColor: colors.border, background: "#fff" }}>
        <h3 className="font-semibold text-lg">
          {CP.titles.simHeading} <span className="text-sm" style={{ color: mutedColor }}>{CP.labels.planTaxNote}</span>
        </h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {pricing.plans.map(p => (
            <div key={p.key} className="p-4 rounded-xl border" style={{ borderColor: colors.border }}>
              <div className="flex items-center gap-2">
                {p.badge && (
                  <span className="text-xs px-2 py-1 rounded" style={{ background: colors.badgeBg, color: colors.badgeText }}>
                    {p.badge}
                  </span>
                )}
                <div className="font-semibold">{p.name}</div>
              </div>
              <div className="mt-2 text-sm" style={{ color: mutedColor }}>{p.note}</div>
              <div className="mt-3 text-2xl font-bold">
                {estimated ? "（ここに計算結果）" : "——"}
              </div>
              <div className="mt-1 text-xs" style={{ color: mutedColor }}>
                {CP.labels.shootTime}: {pricing.durations[p.key]?.shoot || "-"} ／ {CP.labels.stayTime}: {pricing.durations[p.key]?.stay || "-"}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs" style={{ color: mutedColor }}>
          {CP.labels.estimateNotice}
        </div>
      </div>
    </div>
  );
}
