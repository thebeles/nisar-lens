import { useEffect, useState } from 'react';

const STORAGE_KEY = 'nisar-lens-language';
const LANGUAGE_EVENT = 'nisar-lens-language-change';
const LEGACY_STORAGE_KEY = String.fromCharCode(122, 101, 110, 105, 116, 104, 45, 108, 97, 110, 103, 117, 97, 103, 101);

export const translations = {
  'HOME': 'ГЛАВНАЯ', 'THE MISSION': 'МИССИЯ', 'TEAM': 'КОМАНДА',
  'Dashboard': 'Панель данных', 'Open navigation menu': 'Открыть меню навигации', 'Close navigation menu': 'Закрыть меню навигации',
  'NASA-ISRO JOINT EARTH SYSTEM MISSION': 'СОВМЕСТНАЯ МИССИЯ NASA И ISRO ПО ИЗУЧЕНИЮ ЗЕМЛИ',
  'Discover how radar reveals millimeter-scale changes on Earth’s surface —': 'Узнайте, как радар выявляет миллиметровые изменения поверхности Земли —',
  'penetrating clouds, smoke, and polar night.': 'сквозь облака, дым и полярную ночь.',
  'TRACKING A CHANGING PLANET': 'НАБЛЮДАЕМ ЗА МЕНЯЮЩЕЙСЯ ПЛАНЕТОЙ', 'THROUGH RADAR WAVES.': 'С ПОМОЩЬЮ РАДАРНЫХ ВОЛН.',
  'TURNING SURFACE SIGNALS': 'ПРЕВРАЩАЕМ СИГНАЛЫ ПОВЕРХНОСТИ', 'INTO REAL-WORLD INSIGHTS.': 'В ПОНЯТНЫЕ ДАННЫЕ О ЗЕМЛЕ.', 'Explore Phenomena': 'Изучить явления',
  'Back to Home': 'На главную', 'MISSION DATA EXPLORER · NASA-ISRO SAR': 'ОБЗОР ДАННЫХ · РАДАР NASA–ISRO',
  'Workspace': 'Рабочая область', 'Select Study Region or Query Global Coordinates': 'Выберите регион или задайте координаты',
  'Select a scientific testbed to fetch verified NISAR L-band SAR granules from NASA Earthdata Cloud, or query custom coordinates.': 'Выберите регион, чтобы получить радарные данные NISAR L-диапазона из NASA Earthdata, или задайте координаты вручную.',
  'Restore Baseline Archive': 'Вернуть исходный архив', 'Custom Global Coordinates': 'Координаты на карте',
  'Query NASA CMR': 'Найти в NASA CMR', 'Latitude': 'Широта', 'Longitude': 'Долгота',
  'Bengal Delta': 'Дельта Бенгалии', 'Eastern Himalayas': 'Восточные Гималаи', 'Sundarbans Coast': 'Побережье Сундарбана',
  'Svalbard Arctic': 'Арктика, Шпицберген', 'Meghna Baseline': 'Архив Мегхны', 'Monsoon Inundation': 'Муссонные затопления',
  'Glacial Elevation': 'Ледники и рельеф', 'Tidal Mangroves': 'Приливные мангровые леса', 'Permafrost & Cryosphere': 'Мерзлота и криосфера',
  'L3 Soil Moisture': 'Влажность почвы L3', 'Observation details': 'Сведения о наблюдении', 'QA checks & watchpoints': 'Контроль качества и закладки',
  'Overview (3-Pane)': 'Обзор (3 панели)', 'Metadata': 'Метаданные', 'SAR Browse': 'Радарный снимок', 'QA & Saved Items': 'Контроль качества и сохранённое',
  'Inspection Workbench': 'Рабочая область анализа', 'Select an observation': 'Выберите наблюдение',
  'MISSION WATCHPOINTS · THIS BROWSER': 'ЗАКЛАДКИ · ЭТОТ БРАУЗЕР', 'Pin Watchpoint': 'Сохранить закладку',
  'Watchpoint Pinned': 'Закладка сохранена', 'Remove watchpoint': 'Удалить закладку',
  'TARGET OBSERVATION SELECTOR · NASA EARTHDATA CLOUD': 'ВЫБОР ОБЛАСТИ НАБЛЮДЕНИЯ · NASA EARTHDATA',
  'Filters': 'Фильтры', 'All Products': 'Все продукты', 'From': 'С', 'To': 'По', 'Reset': 'Сбросить',
  'Matching Passes:': 'Подходящие пролёты:', 'Coverage:': 'Покрытие:', 'Cycle:': 'Цикл:', '12-Day Repeat': 'Повтор через 12 дней',
  'CHRONOLOGICAL OBSERVATIONS': 'НАБЛЮДЕНИЯ ПО ДАТАМ', '12-DAY ORBIT MATCH': 'СОВПАДЕНИЕ ОРБИТ · 12 ДНЕЙ',
  'Compare Repeat-Pass Pair': 'Сравнить парные пролёты', 'No observations match these filters.': 'Нет наблюдений по выбранным фильтрам.',
  'Click [A] & [B] to compare · Scroll to explore': 'Нажмите [A] и [B] для сравнения · Прокрутите список',
  'SELECTED OBSERVATION RECORD': 'ВЫБРАННОЕ НАБЛЮДЕНИЕ', 'Real L-band radar browse': 'Радарный снимок L-диапазона',
  'QA checks & saved watchpoints': 'Контроль качества и закладки', 'Open Full PNG': 'Открыть PNG полностью',
  'Min Moisture': 'Мин. влажность', 'Mean Moisture': 'Средняя влажность', 'Peak Moisture': 'Макс. влажность',
  'Export Report JSON': 'Экспорт отчёта JSON', 'Download PNG Mask': 'Скачать маску PNG', 'Exit Multi-Temporal Compare': 'Закрыть сравнение дат',
  'Copy ASF Cloud URL': 'Скопировать URL ASF Cloud', 'Download HDF5': 'Скачать HDF5', 'Pin Change Study to Database': 'Сохранить исследование изменений',
  'Draped on 3D Globe': 'Показать на 3D-глобусе', 'Save Change Study': 'Сохранить исследование изменений', 'Display all 3 inspection panels side-by-side': 'Показать все 3 панели рядом',
  'Focus on technical metadata and download assets': 'Метаданные и загрузка файлов', 'Focus on SAR browse imagery viewer': 'Просмотр радарных снимков',
  'Focus on QA verification checks and saved watchpoints': 'Проверка качества и закладки',
};

export function getLanguage() {
  return (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)) === 'ru' ? 'ru' : 'en';
}

export function setLanguage(language) {
  localStorage.setItem(STORAGE_KEY, language);
  window.dispatchEvent(new Event(LANGUAGE_EVENT));
}

export function useLanguage() {
  const [language, updateLanguage] = useState(getLanguage);
  useEffect(() => {
    const onChange = () => updateLanguage(getLanguage());
    window.addEventListener(LANGUAGE_EVENT, onChange);
    return () => window.removeEventListener(LANGUAGE_EVENT, onChange);
  }, []);
  return [language, setLanguage];
}

export function t(text, language) {
  return language === 'ru' ? translations[text] ?? text : text;
}

export function LanguageSwitcher({ language, onChange }) {
  return <div className="inline-flex items-center gap-0.5 rounded-full border border-white/15 bg-white/[0.04] p-0.5 font-mono text-[10px]" aria-label="Language">
    {['en', 'ru'].map((code) => <button key={code} type="button" onClick={() => onChange(code)} aria-pressed={language === code} className={`rounded-full px-2 py-1 transition-colors ${language === code ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`}>{code.toUpperCase()}</button>)}
  </div>;
}
