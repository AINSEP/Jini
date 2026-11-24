import { translationEntry } from "../../shell/lib/translation-entry.js";
/**
 * @file Users screen dictionary, locales hi…bn — one of four part files `../users-i18n.ts`
 * merges into `USERS_TRANSLATIONS`. Split per locale group only so each file stays under the
 * package's file-size limit; the content is the original dictionary's, verbatim.
 */
export const USERS_TRANSLATIONS_D: Record<string, Record<string, string>> = {
  hi: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "आप वह अनुमति प्रदान नहीं कर सकते जो आपके पास स्वयं नहीं है।",
    "You do not have permission to do that.": "आपके पास ऐसा करने की अनुमति नहीं है।",
    "That username is already in use.": "वह उपयोगकर्ता नाम पहले से उपयोग में है।",
    "The workspace must keep at least one active owner.": "वर्कस्पेस में कम से कम एक सक्रिय स्वामी होना आवश्यक है।",
    "You cannot delete your own account.": "आप अपना स्वयं का खाता नहीं हटा सकते।",
    "This user is in the Trash; restore them first.": "यह उपयोगकर्ता ट्रैश में है; पहले उसे पुनर्स्थापित करें।",
    "A user with this username is in the Trash; restore or delete them permanently first.": "इस उपयोगकर्ता नाम वाला एक उपयोगकर्ता पहले से ही ट्रैश में है; पहले उसे पुनर्स्थापित करें या स्थायी रूप से हटाएं।",
    "Please correct the highlighted fields.": "कृपया हाइलाइट किए गए फ़ील्ड ठीक करें।",
    People: "लोग",
    Users: "उपयोगकर्ता",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "इस एडमिन तक पहुंच वाले ऑपरेटर खाते — रोल और पॉलिसी असाइन करें, या पहुंच अक्षम करें।",
    "New user": "नया उपयोगकर्ता",

    Username: "उपयोगकर्ता नाम",
    "Email (optional)": "ईमेल (वैकल्पिक)",
    Password: "पासवर्ड",
    "Create user": "उपयोगकर्ता बनाएं",

    Email: "ईमेल",
    "(none)": "(कोई नहीं)",
    "Save email": "ईमेल सहेजें",
    "Assign role": "रोल असाइन करें",
    "Select a role…": "एक रोल चुनें…",
    "(built-in)": "(बिल्ट-इन)",
    Assign: "असाइन करें",
    "Attach policy": "पॉलिसी जोड़ें",
    "Select a policy…": "एक पॉलिसी चुनें…",
    Attach: "जोड़ें",

    "Actions for user": "उपयोगकर्ता के लिए कार्रवाइयां",
    none: "कोई नहीं",

    "No users yet.": "अभी तक कोई उपयोगकर्ता नहीं है।",
    "Create your first operator account to get started.": "शुरू करने के लिए अपना पहला ऑपरेटर खाता बनाएं।",
    Roles: "रोल",
    Policies: "पॉलिसी",

    "Disable this user?": "इस उपयोगकर्ता को अक्षम करें?",
    "They will not be able to sign in until re-enabled.": "फिर से सक्षम होने तक वे साइन इन नहीं कर पाएंगे।",
    "Delete this user?": "इस उपयोगकर्ता को हटाएं?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "उन्हें साइन आउट कर ट्रैश में ले जाया जाएगा। आप उन्हें वहां से पुनर्स्थापित कर सकते हैं; 60 दिनों के बाद वे स्थायी रूप से हटा दिए जाते हैं।",
    "Move to trash": "ट्रैश में ले जाएँ",
    Manage: "प्रबंधित करें",

    "Reset password?": "पासवर्ड रीसेट करें?",
    "Set a new password for": "इसके लिए नया पासवर्ड सेट करें",
    "Every active session for this user will be signed out.":
      "इस उपयोगकर्ता का हर सक्रिय सत्र साइन आउट कर दिया जाएगा।",
    "New password": "नया पासवर्ड",
    "Reset password": "पासवर्ड रीसेट करें",

    "Loading users…": "उपयोगकर्ता लोड हो रहे हैं…",

    "failed to load users": "उपयोगकर्ता लोड नहीं हो सके",
    "failed to create user": "उपयोगकर्ता नहीं बन सका",
    "failed to assign role": "रोल असाइन नहीं हो सका",
    "failed to attach policy": "पॉलिसी नहीं जोड़ी जा सकी",
    "failed to update email": "ईमेल अपडेट नहीं हो सका",
    "failed to reset password": "पासवर्ड रीसेट नहीं हो सका",
    "failed to change status": "स्थिति नहीं बदली जा सकी",
    "failed to delete user": "उपयोगकर्ता को हटाया नहीं जा सका",
    "Password changed. Sign in again with your new password.": "पासवर्ड बदल दिया गया है। अपने नए पासवर्ड से फिर से साइन इन करें।",
  },
  ur: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "آپ وہ اجازت نہیں دے سکتے جو خود آپ کے پاس نہیں ہے۔",
    "You do not have permission to do that.": "آپ کو یہ کرنے کی اجازت نہیں ہے۔",
    "That username is already in use.": "یہ صارف نام پہلے سے استعمال میں ہے۔",
    "The workspace must keep at least one active owner.": "ورک اسپیس میں کم از کم ایک فعال مالک کا ہونا ضروری ہے۔",
    "You cannot delete your own account.": "آپ اپنا اکاؤنٹ حذف نہیں کر سکتے۔",
    "This user is in the Trash; restore them first.": "یہ صارف ٹریش میں ہے؛ پہلے اسے بحال کریں۔",
    "A user with this username is in the Trash; restore or delete them permanently first.": "اس صارف نام والا ایک صارف پہلے ہی ٹریش میں موجود ہے؛ پہلے اسے بحال کریں یا مستقل طور پر حذف کریں۔",
    "Please correct the highlighted fields.": "براہ کرم نمایاں کردہ خانوں کو درست کریں۔",
    People: "افراد",
    Users: "صارفین",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "اس ایڈمن تک رسائی رکھنے والے آپریٹر اکاؤنٹس — رولز اور پالیسیاں تفویض کریں، یا رسائی غیرفعال کریں۔",
    "New user": "نیا صارف",

    Username: "صارف نام",
    "Email (optional)": "ای میل (اختیاری)",
    Password: "پاس ورڈ",
    "Create user": "صارف بنائیں",

    Email: "ای میل",
    "(none)": "(کوئی نہیں)",
    "Save email": "ای میل محفوظ کریں",
    "Assign role": "رول تفویض کریں",
    "Select a role…": "ایک رول منتخب کریں…",
    "(built-in)": "(بلٹ اِن)",
    Assign: "تفویض کریں",
    "Attach policy": "پالیسی منسلک کریں",
    "Select a policy…": "ایک پالیسی منتخب کریں…",
    Attach: "منسلک کریں",

    "Actions for user": "صارف کے لیے کارروائیاں",
    none: "کوئی نہیں",

    "No users yet.": "ابھی تک کوئی صارف نہیں ہے۔",
    "Create your first operator account to get started.": "شروع کرنے کے لیے اپنا پہلا آپریٹر اکاؤنٹ بنائیں۔",
    Roles: "رولز",
    Policies: "پالیسیاں",

    "Disable this user?": "اس صارف کو غیرفعال کریں؟",
    "They will not be able to sign in until re-enabled.": "دوبارہ فعال ہونے تک وہ سائن ان نہیں کر سکیں گے۔",
    "Delete this user?": "کیا اس صارف کو حذف کیا جائے؟",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "انہیں سائن آؤٹ کر کے ٹریش میں منتقل کر دیا جائے گا۔ آپ انہیں وہاں سے بحال کر سکتے ہیں؛ 60 دن بعد وہ مستقل طور پر حذف کر دیے جاتے ہیں۔",
    "Move to trash": "ٹریش میں منتقل کریں",
    Manage: "منظم کریں",

    "Reset password?": "پاس ورڈ ری سیٹ کریں؟",
    "Set a new password for": "اس کے لیے نیا پاس ورڈ سیٹ کریں",
    "Every active session for this user will be signed out.":
      "اس صارف کا ہر فعال سیشن سائن آؤٹ کر دیا جائے گا۔",
    "New password": "نیا پاس ورڈ",
    "Reset password": "پاس ورڈ ری سیٹ کریں",

    "Loading users…": "صارفین لوڈ ہو رہے ہیں…",

    "failed to load users": "صارفین لوڈ نہ ہو سکے",
    "failed to create user": "صارف نہ بن سکا",
    "failed to assign role": "رول تفویض نہ ہو سکا",
    "failed to attach policy": "پالیسی منسلک نہ ہو سکی",
    "failed to update email": "ای میل اپ ڈیٹ نہ ہو سکی",
    "failed to reset password": "پاس ورڈ ری سیٹ نہ ہو سکا",
    "failed to change status": "حیثیت تبدیل نہ ہو سکی",
    "failed to delete user": "صارف حذف نہ ہو سکا",
    "Password changed. Sign in again with your new password.": "پاس ورڈ تبدیل ہو گیا۔ اپنے نئے پاس ورڈ کے ساتھ دوبارہ سائن ان کریں۔",
  },
  bn: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "আপনার নিজের কাছে নেই এমন অনুমতি আপনি দিতে পারবেন না।",
    "You do not have permission to do that.": "আপনার এটি করার অনুমতি নেই।",
    "That username is already in use.": "সেই ব্যবহারকারীর নাম ইতিমধ্যে ব্যবহৃত হচ্ছে।",
    "The workspace must keep at least one active owner.": "ওয়ার্কস্পেসে কমপক্ষে একজন সক্রিয় মালিক থাকা আবশ্যক।",
    "You cannot delete your own account.": "আপনি নিজের অ্যাকাউন্ট মুছতে পারবেন না।",
    "This user is in the Trash; restore them first.": "এই ব্যবহারকারী ট্র্যাশে আছেন; প্রথমে পুনরুদ্ধার করুন।",
    "A user with this username is in the Trash; restore or delete them permanently first.": "এই ব্যবহারকারী নামের একজন ব্যবহারকারী ইতিমধ্যে ট্র্যাশে আছেন; প্রথমে পুনরুদ্ধার করুন অথবা স্থায়ীভাবে মুছুন।",
    "Please correct the highlighted fields.": "অনুগ্রহ করে হাইলাইট করা ফিল্ডগুলো সংশোধন করুন।",
    People: "ব্যক্তি",
    Users: "ব্যবহারকারী",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "এই অ্যাডমিনে অ্যাক্সেস থাকা অপারেটর অ্যাকাউন্ট — রোল ও পলিসি নির্ধারণ করুন, অথবা অ্যাক্সেস নিষ্ক্রিয় করুন।",
    "New user": "নতুন ব্যবহারকারী",

    Username: "ইউজারনেম",
    "Email (optional)": "ইমেইল (ঐচ্ছিক)",
    ...translationEntry({ source: "Password", translated: "পাসওয়ার্ড" }),
    "Create user": "ব্যবহারকারী তৈরি করুন",

    Email: "ইমেইল",
    "(none)": "(কোনোটি না)",
    "Save email": "ইমেইল সংরক্ষণ করুন",
    "Assign role": "রোল নির্ধারণ করুন",
    "Select a role…": "একটি রোল বেছে নিন…",
    "(built-in)": "(বিল্ট-ইন)",
    Assign: "নির্ধারণ করুন",
    "Attach policy": "পলিসি সংযুক্ত করুন",
    "Select a policy…": "একটি পলিসি বেছে নিন…",
    Attach: "সংযুক্ত করুন",

    "Actions for user": "ব্যবহারকারীর জন্য কার্যক্রম",
    none: "কোনোটি না",

    "No users yet.": "এখনো কোনো ব্যবহারকারী নেই।",
    "Create your first operator account to get started.": "শুরু করতে আপনার প্রথম অপারেটর অ্যাকাউন্ট তৈরি করুন।",
    Roles: "রোল",
    Policies: "পলিসি",

    "Disable this user?": "এই ব্যবহারকারীকে নিষ্ক্রিয় করবেন?",
    "They will not be able to sign in until re-enabled.": "পুনরায় সক্ষম না করা পর্যন্ত তিনি সাইন ইন করতে পারবেন না।",
    "Delete this user?": "এই ব্যবহারকারীকে মুছবেন?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "তাকে সাইন আউট করে ট্র্যাশে সরানো হবে। আপনি সেখান থেকে পুনরুদ্ধার করতে পারবেন; ৬০ দিন পর স্থায়ীভাবে মুছে ফেলা হয়।",
    "Move to trash": "ট্র্যাশে সরান",
    Manage: "পরিচালনা করুন",

    "Reset password?": "পাসওয়ার্ড রিসেট করবেন?",
    "Set a new password for": "এর জন্য নতুন পাসওয়ার্ড সেট করুন",
    "Every active session for this user will be signed out.":
      "এই ব্যবহারকারীর প্রতিটি সক্রিয় সেশন সাইন আউট করা হবে।",
    "New password": "নতুন পাসওয়ার্ড",
    "Reset password": "পাসওয়ার্ড রিসেট করুন",

    "Loading users…": "ব্যবহারকারী লোড হচ্ছে…",

    "failed to load users": "ব্যবহারকারী লোড করা যায়নি",
    "failed to create user": "ব্যবহারকারী তৈরি করা যায়নি",
    "failed to assign role": "রোল নির্ধারণ করা যায়নি",
    "failed to attach policy": "পলিসি সংযুক্ত করা যায়নি",
    "failed to update email": "ইমেইল আপডেট করা যায়নি",
    "failed to reset password": "পাসওয়ার্ড রিসেট করা যায়নি",
    "failed to change status": "অবস্থা পরিবর্তন করা যায়নি",
    "failed to delete user": "ব্যবহারকারীকে মুছতে ব্যর্থ",
    "Password changed. Sign in again with your new password.": "পাসওয়ার্ড পরিবর্তন করা হয়েছে। আপনার নতুন পাসওয়ার্ড দিয়ে আবার সাইন ইন করুন।",
  },
};
