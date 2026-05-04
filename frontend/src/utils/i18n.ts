import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslation from '../assets/locales/en.json';
import viTranslation from '../assets/locales/vi.json';

// Hàm lấy ngôn ngữ khởi tạo theo logic:
// 1. Ưu tiên ngôn ngữ đã lưu trong máy (localStorage)
// 2. Nếu chưa có (lần đầu dùng), kiểm tra ngôn ngữ trình duyệt (nếu là tiếng Việt thì dùng 'vi', còn lại dùng 'en')
const getInitialLang = () => {
  const savedLang = localStorage.getItem('i18nextLng');
  if (savedLang) return savedLang;

  const browserLang = navigator.language.split('-')[0]; // Lấy 'vi' từ 'vi-VN'
  const detected = browserLang === 'vi' ? 'vi' : 'en';
  
  // "Chốt" luôn ngôn ngữ này cho những lần sau
  localStorage.setItem('i18nextLng', detected);
  return detected;
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslation,
      },
      vi: {
        translation: viTranslation,
      },
    },
    lng: getInitialLang(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
