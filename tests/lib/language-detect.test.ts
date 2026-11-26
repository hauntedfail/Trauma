import { describe, expect, it } from "vitest";

import {
  detectArticleLanguage,
  isReaderFontPreset,
  isRtlLanguage,
  normalizeBcp47Lang,
} from "~/lib/language-detect";

describe("language-detect", () => {
  it("respects explicit langCode overrides", () => {
    expect(detectArticleLanguage({ langCode: "ja", text: "Hello world" })).toBe("ja");
    expect(detectArticleLanguage({ langCode: "zh-TW", text: "Hello" })).toBe("zh-Hant");
    expect(detectArticleLanguage({ langCode: "zh_CN", text: "Hello" })).toBe("zh-Hans");
  });

  it("detects Japanese including mixed Japanese and English technical prose", () => {
    expect(
      detectArticleLanguage({
        title: "SolidJS 1.9 と Tailwind v4 の設計メモ",
        text: "長文リーダーでは和欧混植のバランスと行間が重要になります。",
      }),
    ).toBe("ja");
  });

  it("detects Korean, Simplified Chinese, Traditional Chinese, Arabic, Hindi, Thai, and English", () => {
    expect(
      detectArticleLanguage({
        text: "한국어 장문 읽기에서는 단어 단위 줄바꿈이 중요합니다.",
      }),
    ).toBe("ko");
    expect(
      detectArticleLanguage({
        text: "这是一个关于简体中文排版与阅读体验的技术文章，讨论行高与字体选择。",
      }),
    ).toBe("zh-Hans");
    expect(
      detectArticleLanguage({
        text: "這是一個關於繁體中文排版與閱讀體驗的技術文章，討論行高與字體選擇。",
      }),
    ).toBe("zh-Hant");
    expect(
      detectArticleLanguage({
        text: "القراءة الطويلة باللغة العربية تتطلب تباعد أسطر مناسب دون تباعد أحرف.",
      }),
    ).toBe("ar");
    expect(
      detectArticleLanguage({
        text: "लंबे लेख पढ़ने के लिए स्पष्ट देवनागरी टाइपोग्राफी और उचित पंक्ति ऊंचाई आवश्यक है।",
      }),
    ).toBe("hi");
    expect(
      detectArticleLanguage({
        text: "การอ่านบทความภาษาไทยระยะยาวต้องการระยะห่างบรรทัดและแบบอักษรที่อ่านสบายตา",
      }),
    ).toBe("th");
    expect(
      detectArticleLanguage({
        title: "Designing Calm Interfaces",
        text: "Readable long-form typography balances measure, leading, and contrast.",
      }),
    ).toBe("en");
  });

  it("validates the four reading font presets", () => {
    expect(isReaderFontPreset("sans")).toBe(true);
    expect(isReaderFontPreset("serif")).toBe(true);
    expect(isReaderFontPreset("focus")).toBe(true);
    expect(isReaderFontPreset("mono")).toBe(true);
    expect(isReaderFontPreset("comic")).toBe(false);
    expect(isReaderFontPreset(null)).toBe(false);
  });

  it("identifies RTL languages accurately", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("he")).toBe(true);
    expect(isRtlLanguage("fa-IR")).toBe(true);
    expect(isRtlLanguage("ja")).toBe(false);
    expect(isRtlLanguage("en")).toBe(false);
  });

  it("normalizes BCP-47 tags", () => {
    expect(normalizeBcp47Lang("en_US")).toBe("en-US");
    expect(normalizeBcp47Lang("ja-JP")).toBe("ja");
    expect(normalizeBcp47Lang("")).toBe("");
  });
});
