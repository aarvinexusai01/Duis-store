import type { NoticeLanguage } from "./privacy"

/**
 * The standalone Privacy Notice (DPDP Rule 3, doc/06 Phase 12): understandable
 * on its own, in plain language, with an itemised list of the data and its
 * purposes, and how to withdraw consent, use rights and complain to the Board.
 * In code rather than the CMS because it belongs to NOTICE_VERSION: a material
 * change here is a new version, and customers are asked again.
 *
 * Keep it true: it describes what the shop actually does. Retention has no
 * fixed periods beyond the tax rule because the shop doesn't run any yet.
 */
export type PrivacyNoticeContent = {
  title: string
  description: string
  intro: string
  version: string
  otherLanguage: { label: string; href: string }
  collect: {
    heading: string
    what: string
    why: string
    optional: string
    items: { name: string; what: string; why: string; optional?: boolean }[]
  }
  sharing: { heading: string; intro: string; items: string[]; abroad: string }
  keeping: { heading: string; items: string[] }
  rights: { heading: string; intro: string; items: string[]; effect: string }
  complaints: {
    heading: string
    grievance: string
    officer: string
    timing: string
    board: string
  }
  children: { heading: string; body: string }
  contact: {
    heading: string
    support: string
    privacy: string
    phone: string
    address: string
    hours: string
    name: string
    email: string
  }
}

export const PRIVACY_NOTICE: Record<NoticeLanguage, PrivacyNoticeContent> = {
  en: {
    title: "Privacy Notice",
    description:
      "What personal data DUIS collects and why, who receives it, how to withdraw consent, use your rights and complain to the Data Protection Board.",
    intro:
      "This notice explains in plain language what personal data DUIS asks you for, why, and what you can do about it. It is given under India's Digital Personal Data Protection Act, 2023. We ask for your consent with a box on each form; every box is unticked until you tick it.",
    version: "Notice version",
    otherLanguage: {
      label: "हिंदी में पढ़ें",
      href: "/policies/privacy-notice/hi",
    },
    collect: {
      heading: "What we ask for, and why",
      what: "What we ask for",
      why: "What it's for",
      optional: "Optional",
      items: [
        {
          name: "Your account",
          what: "Name, email, mobile number and password (stored only in scrambled form). If you use Google to sign in: your name and email from Google. Your statement that you are 18 or older.",
          why: "To create and run your account, sign you in and show your orders.",
        },
        {
          name: "Your orders",
          what: "Name, mobile number, email, delivery address, what you bought, amounts, and the payment's status and reference. Card and UPI details are entered with our payment provider; we never store them.",
          why: "To deliver the order, send its updates and invoice, handle cancellations, refunds and exchanges, and keep the tax records the law requires.",
        },
        {
          name: "Saved addresses",
          what: "Name, mobile number and address.",
          why: "To deliver your orders without you typing them again.",
        },
        {
          name: "Contact messages",
          what: "Name, email, phone number and order number if you give them, and your message.",
          why: "To answer your message.",
        },
        {
          name: "Back-in-stock alerts",
          what: "Your email address.",
          why: "To tell you when that item is back in stock.",
        },
        {
          name: "Reviews",
          what: "Your rating, review, fit and photos. Your first name and last initial are shown with it.",
          why: "To publish your review on the product page.",
        },
        {
          name: "Exchanges",
          what: "Your reason, any note and photos, your contact details and pickup address.",
          why: "To decide and carry out the exchange, including the courier pickup.",
        },
        {
          name: "Marketing",
          what: "Your email address or WhatsApp number.",
          why: "To send you new drops and offers. Buying from us never depends on this.",
          optional: true,
        },
        {
          name: "WhatsApp order updates",
          what: "Your mobile number.",
          why: "To send updates about your orders on WhatsApp.",
          optional: true,
        },
        {
          name: "Analytics and marketing cookies",
          what: "How you use the site, through cookies, only if you allow them.",
          why: "To understand what works and measure our advertising. Change this any time from “Cookie settings” at the bottom of every page.",
          optional: true,
        },
        {
          name: "Security and essential cookies",
          what: "Internet address, browser details, and the cookies that keep your bag and sign-in working.",
          why: "To run the shop and protect it and you from abuse.",
        },
      ],
    },
    sharing: {
      heading: "Who receives it",
      intro:
        "We share only what each one needs for the job. We don't sell your personal data.",
      items: [
        "Our payment provider (Razorpay): to take payments and make refunds.",
        "Our shipping partner (Shiprocket) and its couriers: your name, mobile number and address, to deliver and collect parcels.",
        "Our email and text message providers: to send your order messages and sign-in codes.",
        "The companies that host, protect and back up the website, and those that deliver images.",
        "Government authorities, when the law requires it.",
      ],
      abroad:
        "Some of these providers may process data outside India, as the law allows.",
    },
    keeping: {
      heading: "How long we keep it",
      items: [
        "Order and tax records: at least 72 months, as GST law requires, even if you delete your account.",
        "Your account and saved addresses: while your account is open, or until you remove them or ask us to delete them.",
        "Contact messages, alerts, reviews and exchange details: for as long as we need them for that purpose, or until you ask us to delete them, unless the law requires us to keep them.",
        "The record of what you agreed to: kept so we can show it. For visitors without an account it holds a scrambled code of the email address, not the address.",
      ],
    },
    rights: {
      heading: "Your rights, and how to use them",
      intro:
        "You can do any of these at any time. For anything not listed with a page, write to the privacy address below.",
      items: [
        "Withdraw consent: turn off marketing and WhatsApp in My account → Profile, or use the unsubscribe link in any marketing email. For other consents, write to us.",
        "See your data: ask us for a summary of the personal data we hold, what we do with it and who we shared it with.",
        "Correct it: change your details in My account → Profile and Addresses, or ask us.",
        "Delete it: request deletion in My account → Profile, or write to us. We remove your personal data except what the law requires us to keep.",
        "Nominate someone: name a person to use these rights for you if you die or can't act yourself, by writing to us.",
        "Complain: see below.",
      ],
      effect:
        "When you withdraw consent we stop using that data for that purpose within a reasonable time. Orders already placed still have to be delivered and recorded, and some services may no longer be possible without it.",
    },
    complaints: {
      heading: "How to complain",
      grievance:
        "Please write to our Grievance Officer first; the Act asks you to try this before going to the Board.",
      officer: "Grievance Officer",
      timing:
        "We acknowledge complaints within 48 hours and resolve them within one month.",
      board:
        "If you aren't satisfied, you can complain to the Data Protection Board of India through its official online complaint system.",
    },
    children: {
      heading: "Under 18",
      body: "Accounts and orders on DUIS are for people aged 18 or older. If you are under 18, please ask a parent or guardian to order for you. If you think we hold a child's data, write to us and we'll deal with it.",
    },
    contact: {
      heading: "Who we are and how to reach us",
      support: "Support",
      privacy: "Privacy requests",
      phone: "Phone",
      address: "Address",
      hours: "Hours",
      name: "Name",
      email: "Email",
    },
  },
  hi: {
    title: "गोपनीयता सूचना",
    description:
      "DUIS कौन-सा व्यक्तिगत डेटा क्यों लेता है, यह किसे मिलता है, और आप सहमति कैसे वापस लें, अपने अधिकारों का उपयोग कैसे करें और डेटा संरक्षण बोर्ड से शिकायत कैसे करें।",
    intro:
      "यह सूचना सरल भाषा में बताती है कि DUIS आपसे कौन-सा व्यक्तिगत डेटा माँगता है, क्यों माँगता है और आप इस बारे में क्या कर सकते हैं। यह भारत के डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 के तहत दी गई है। हम हर फ़ॉर्म पर एक बॉक्स के ज़रिए आपकी सहमति माँगते हैं; जब तक आप टिक न करें, हर बॉक्स खाली रहता है।",
    version: "सूचना का संस्करण",
    otherLanguage: {
      label: "Read in English",
      href: "/policies/privacy-notice",
    },
    collect: {
      heading: "हम क्या माँगते हैं और क्यों",
      what: "हम क्या माँगते हैं",
      why: "यह किसलिए है",
      optional: "वैकल्पिक",
      items: [
        {
          name: "आपका खाता",
          what: "नाम, ईमेल, मोबाइल नंबर और पासवर्ड (केवल कूट रूप में सुरक्षित)। Google से साइन इन करने पर: Google से आपका नाम और ईमेल। आपका यह कथन कि आपकी आयु 18 वर्ष या उससे अधिक है।",
          why: "आपका खाता बनाने और चलाने, आपको साइन इन कराने और आपके ऑर्डर दिखाने के लिए।",
        },
        {
          name: "आपके ऑर्डर",
          what: "नाम, मोबाइल नंबर, ईमेल, डिलीवरी पता, आपने क्या खरीदा, राशि, और भुगतान की स्थिति व संदर्भ। कार्ड और UPI का विवरण हमारे भुगतान प्रदाता के पास दर्ज होता है; हम उसे कभी नहीं रखते।",
          why: "ऑर्डर पहुँचाने, उसकी जानकारी और इनवॉइस भेजने, रद्दीकरण, रिफ़ंड और एक्सचेंज संभालने, और कानून के अनुसार कर रिकॉर्ड रखने के लिए।",
        },
        {
          name: "सहेजे गए पते",
          what: "नाम, मोबाइल नंबर और पता।",
          why: "ताकि आपको दोबारा लिखे बिना आपके ऑर्डर पहुँचाए जा सकें।",
        },
        {
          name: "संपर्क संदेश",
          what: "नाम, ईमेल, आपके देने पर फ़ोन नंबर और ऑर्डर नंबर, और आपका संदेश।",
          why: "आपके संदेश का उत्तर देने के लिए।",
        },
        {
          name: "दोबारा उपलब्ध होने की सूचना",
          what: "आपका ईमेल पता।",
          why: "वह आइटम दोबारा उपलब्ध होने पर आपको बताने के लिए।",
        },
        {
          name: "समीक्षाएँ",
          what: "आपकी रेटिंग, समीक्षा, फ़िट और तस्वीरें। इनके साथ आपका पहला नाम और उपनाम का पहला अक्षर दिखता है।",
          why: "उत्पाद पेज पर आपकी समीक्षा प्रकाशित करने के लिए।",
        },
        {
          name: "एक्सचेंज",
          what: "आपका कारण, कोई टिप्पणी और तस्वीरें, आपका संपर्क विवरण और पिकअप पता।",
          why: "कूरियर पिकअप सहित एक्सचेंज पर निर्णय लेने और उसे पूरा करने के लिए।",
        },
        {
          name: "मार्केटिंग",
          what: "आपका ईमेल पता या WhatsApp नंबर।",
          why: "आपको नए कलेक्शन और ऑफ़र भेजने के लिए। हमसे ख़रीदारी इस पर कभी निर्भर नहीं करती।",
          optional: true,
        },
        {
          name: "WhatsApp पर ऑर्डर की जानकारी",
          what: "आपका मोबाइल नंबर।",
          why: "WhatsApp पर आपके ऑर्डर की जानकारी भेजने के लिए।",
          optional: true,
        },
        {
          name: "एनालिटिक्स और मार्केटिंग कुकीज़",
          what: "आप साइट का उपयोग कैसे करते हैं, कुकीज़ के ज़रिए, केवल आपकी अनुमति होने पर।",
          why: "यह समझने के लिए कि क्या काम करता है और हमारे विज्ञापनों को मापने के लिए। हर पेज के नीचे “Cookie settings” से इसे कभी भी बदलें।",
          optional: true,
        },
        {
          name: "सुरक्षा और आवश्यक कुकीज़",
          what: "इंटरनेट पता, ब्राउज़र का विवरण, और वे कुकीज़ जिनसे आपका बैग और साइन-इन काम करते हैं।",
          why: "दुकान चलाने और उसे व आपको दुरुपयोग से बचाने के लिए।",
        },
      ],
    },
    sharing: {
      heading: "यह किसे मिलता है",
      intro:
        "हम हर एक को केवल उतना ही देते हैं जितना उसके काम के लिए ज़रूरी है। हम आपका व्यक्तिगत डेटा बेचते नहीं हैं।",
      items: [
        "हमारा भुगतान प्रदाता (Razorpay): भुगतान लेने और रिफ़ंड करने के लिए।",
        "हमारा शिपिंग भागीदार (Shiprocket) और उसके कूरियर: पार्सल पहुँचाने और लेने के लिए आपका नाम, मोबाइल नंबर और पता।",
        "हमारे ईमेल और टेक्स्ट मैसेज प्रदाता: आपके ऑर्डर संदेश और साइन-इन कोड भेजने के लिए।",
        "वे कंपनियाँ जो वेबसाइट को होस्ट करती हैं, सुरक्षित रखती हैं और उसका बैकअप लेती हैं, और जो तस्वीरें पहुँचाती हैं।",
        "सरकारी प्राधिकरण, जब कानून इसकी माँग करे।",
      ],
      abroad:
        "इनमें से कुछ प्रदाता कानून की अनुमति के अनुसार भारत के बाहर डेटा प्रोसेस कर सकते हैं।",
    },
    keeping: {
      heading: "हम इसे कितने समय तक रखते हैं",
      items: [
        "ऑर्डर और कर रिकॉर्ड: GST कानून के अनुसार कम से कम 72 महीने, आपका खाता हटाने के बाद भी।",
        "आपका खाता और सहेजे गए पते: जब तक आपका खाता खुला है, या जब तक आप उन्हें हटा न दें या हमसे हटाने को न कहें।",
        "संपर्क संदेश, सूचनाएँ, समीक्षाएँ और एक्सचेंज का विवरण: जब तक उस उद्देश्य के लिए ज़रूरी हो, या जब तक आप हमसे हटाने को न कहें, जब तक कि कानून इन्हें रखना ज़रूरी न करे।",
        "आपने जिस पर सहमति दी उसका रिकॉर्ड: ताकि हम उसे दिखा सकें। बिना खाते वाले आगंतुकों के लिए इसमें ईमेल पते का कूट रूप होता है, पता नहीं।",
      ],
    },
    rights: {
      heading: "आपके अधिकार और उनका उपयोग कैसे करें",
      intro:
        "आप इनमें से कोई भी काम कभी भी कर सकते हैं। जिसके लिए कोई पेज नहीं बताया गया है, उसके लिए नीचे दिए गए गोपनीयता पते पर लिखें।",
      items: [
        "सहमति वापस लें: My account → Profile में मार्केटिंग और WhatsApp बंद करें, या किसी भी मार्केटिंग ईमेल में सदस्यता छोड़ने के लिंक का उपयोग करें। अन्य सहमतियों के लिए हमें लिखें।",
        "अपना डेटा देखें: हमसे अपने व्यक्तिगत डेटा का सारांश माँगें, हम उसके साथ क्या करते हैं और उसे किसके साथ साझा किया गया।",
        "इसे सुधारें: My account → Profile और Addresses में अपना विवरण बदलें, या हमसे कहें।",
        "इसे हटवाएँ: My account → Profile में हटाने का अनुरोध करें, या हमें लिखें। कानून के अनुसार जो रखना ज़रूरी है, उसे छोड़कर हम आपका व्यक्तिगत डेटा हटा देते हैं।",
        "किसी को नामित करें: हमें लिखकर ऐसे व्यक्ति का नाम दें जो आपकी मृत्यु या असमर्थता की स्थिति में आपकी ओर से इन अधिकारों का उपयोग कर सके।",
        "शिकायत करें: नीचे देखें।",
      ],
      effect:
        "सहमति वापस लेने पर हम उचित समय के भीतर उस उद्देश्य के लिए उस डेटा का उपयोग बंद कर देते हैं। पहले से दिए गए ऑर्डर फिर भी पहुँचाए और दर्ज किए जाएँगे, और इसके बिना कुछ सेवाएँ शायद संभव न हों।",
    },
    complaints: {
      heading: "शिकायत कैसे करें",
      grievance:
        "कृपया पहले हमारे शिकायत अधिकारी को लिखें; अधिनियम के अनुसार बोर्ड के पास जाने से पहले यह प्रयास करना होता है।",
      officer: "शिकायत अधिकारी",
      timing:
        "हम 48 घंटे के भीतर शिकायत की पावती देते हैं और एक महीने के भीतर उसका समाधान करते हैं।",
      board:
        "यदि आप संतुष्ट नहीं हैं, तो आप भारतीय डेटा संरक्षण बोर्ड से उसकी आधिकारिक ऑनलाइन शिकायत प्रणाली के ज़रिए शिकायत कर सकते हैं।",
    },
    children: {
      heading: "18 वर्ष से कम आयु",
      body: "DUIS पर खाते और ऑर्डर 18 वर्ष या उससे अधिक आयु के लोगों के लिए हैं। यदि आपकी आयु 18 वर्ष से कम है, तो कृपया अपने माता-पिता या अभिभावक से ऑर्डर करने को कहें। यदि आपको लगता है कि हमारे पास किसी बच्चे का डेटा है, तो हमें लिखें और हम उस पर कार्रवाई करेंगे।",
    },
    contact: {
      heading: "हम कौन हैं और हमसे कैसे संपर्क करें",
      support: "सहायता",
      privacy: "गोपनीयता अनुरोध",
      phone: "फ़ोन",
      address: "पता",
      hours: "समय",
      name: "नाम",
      email: "ईमेल",
    },
  },
}
