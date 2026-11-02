/**
 * DPDP notices shown beside each consent checkbox (doc/06 Phase 12, Act s.5
 * and s.6, Rule 3): for each purpose, the data asked for and what it's used
 * for, in English and Hindi. A wording change is a new NOTICE_VERSION, so
 * every recorded consent says which text the person saw.
 */

export const NOTICE_VERSION = "2026-11-02"

export const CONSENT_PURPOSES = [
  "account",
  "age",
  "order",
  "address",
  "contact",
  "stock_alert",
  "review",
  "exchange",
  "marketing",
  "marketing_whatsapp",
  "whatsapp_updates",
] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export const NOTICE_LANGUAGES = ["en", "hi"] as const
export type NoticeLanguage = (typeof NOTICE_LANGUAGES)[number]

/** Where each box links for the full notice, rights and complaints. */
export const PRIVACY_NOTICE_PATH = "/policies/privacy-policy"

export const CONSENT_TEXT: Record<
  ConsentPurpose,
  Record<NoticeLanguage, string>
> = {
  account: {
    en: "I agree to DUIS using my name, email and mobile number to create and run my account, sign me in and show my orders.",
    hi: "मैं सहमत हूँ कि DUIS मेरा खाता बनाने और चलाने, मुझे साइन इन कराने और मेरे ऑर्डर दिखाने के लिए मेरे नाम, ईमेल और मोबाइल नंबर का उपयोग करे।",
  },
  age: {
    en: "I am 18 years of age or older.",
    hi: "मेरी आयु 18 वर्ष या उससे अधिक है।",
  },
  order: {
    en: "I agree to DUIS using my name, mobile number, email, delivery address and payment details to deliver this order, send me its updates and invoice, and handle any cancellation or exchange.",
    hi: "मैं सहमत हूँ कि DUIS इस ऑर्डर की डिलीवरी, इसकी जानकारी और इनवॉइस भेजने, और किसी रद्दीकरण या एक्सचेंज के लिए मेरे नाम, मोबाइल नंबर, ईमेल, डिलीवरी पते और भुगतान विवरण का उपयोग करे।",
  },
  address: {
    en: "I agree to DUIS saving this name, mobile number and address in my account for delivering my orders.",
    hi: "मैं सहमत हूँ कि DUIS मेरे ऑर्डर की डिलीवरी के लिए यह नाम, मोबाइल नंबर और पता मेरे खाते में सहेजे।",
  },
  contact: {
    en: "I agree to DUIS using my name, email, phone number and message to reply to this enquiry.",
    hi: "मैं सहमत हूँ कि DUIS इस प्रश्न का उत्तर देने के लिए मेरे नाम, ईमेल, फ़ोन नंबर और संदेश का उपयोग करे।",
  },
  stock_alert: {
    en: "I agree to DUIS using my email or mobile number to tell me once when this item is back in stock.",
    hi: "मैं सहमत हूँ कि यह आइटम दोबारा उपलब्ध होने पर DUIS मुझे एक बार सूचित करने के लिए मेरे ईमेल या मोबाइल नंबर का उपयोग करे।",
  },
  review: {
    en: "I agree to DUIS publishing my review, my first name and last initial, and any photos I add, on the product page.",
    hi: "मैं सहमत हूँ कि DUIS उत्पाद पेज पर मेरी समीक्षा, मेरा पहला नाम और उपनाम का पहला अक्षर, और मेरे द्वारा जोड़ी गई तस्वीरें प्रकाशित करे।",
  },
  exchange: {
    en: "I agree to DUIS using my reason, photos, contact details and pickup address to process this exchange.",
    hi: "मैं सहमत हूँ कि DUIS यह एक्सचेंज पूरा करने के लिए मेरे कारण, तस्वीरों, संपर्क विवरण और पिकअप पते का उपयोग करे।",
  },
  marketing: {
    en: "I agree to DUIS emailing me about new drops and offers. I can unsubscribe at any time.",
    hi: "मैं सहमत हूँ कि DUIS मुझे नए कलेक्शन और ऑफ़र के बारे में ईमेल भेजे। मैं कभी भी सदस्यता छोड़ सकता/सकती हूँ।",
  },
  marketing_whatsapp: {
    en: "I agree to DUIS sending me new drops and offers on WhatsApp. I can turn this off at any time.",
    hi: "मैं सहमत हूँ कि DUIS मुझे WhatsApp पर नए कलेक्शन और ऑफ़र भेजे। मैं इसे कभी भी बंद कर सकता/सकती हूँ।",
  },
  whatsapp_updates: {
    en: "I agree to DUIS sending updates about my orders to my mobile number on WhatsApp. I can turn this off at any time.",
    hi: "मैं सहमत हूँ कि DUIS मेरे ऑर्डर की जानकारी WhatsApp पर मेरे मोबाइल नंबर पर भेजे। मैं इसे कभी भी बंद कर सकता/सकती हूँ।",
  },
}

export const NOTICE_UI: Record<
  NoticeLanguage,
  { notice: string; rights: string; switchTo: string; required: string }
> = {
  en: {
    notice: "Privacy Notice",
    rights:
      "You can withdraw consent, see or delete your data, or complain to the Data Protection Board: see the",
    switchTo: "हिंदी में पढ़ें",
    required: "Please tick this box to continue.",
  },
  hi: {
    notice: "गोपनीयता सूचना",
    rights:
      "आप अपनी सहमति वापस ले सकते हैं, अपना डेटा देख या हटा सकते हैं, या डेटा संरक्षण बोर्ड से शिकायत कर सकते हैं: देखें",
    switchTo: "Read in English",
    required: "आगे बढ़ने के लिए कृपया इस बॉक्स पर टिक करें।",
  },
}

/** The account-consent cookie set when the sign-up boxes are ticked. */
export const ACCOUNT_CONSENT_COOKIE = "duis_privacy"

/** "2026-11-02.en": the notice version and language that were ticked. */
export function parseAccountConsent(
  value: string | undefined | null,
): { version: string; language: NoticeLanguage } | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.(en|hi)$/.exec(value ?? "")
  if (!match || match[1] !== NOTICE_VERSION) return null
  return { version: match[1], language: match[2] as NoticeLanguage }
}

/** The consent fields a ConsentFields block adds to a submitted form. */
export function consentFromForm(form: FormData): {
  consent: true
  consentLanguage: NoticeLanguage
} {
  return {
    // Anything but a tick fails the operation's `z.literal(true)`.
    consent: (form.get("consent") === "true") as true,
    consentLanguage: form.get("consentLanguage") === "hi" ? "hi" : "en",
  }
}
