/**
 * NewTech System - بيانات الشركات والموردين المعتمدة
 * تدعم: شركات المول الـ 31 + موردي البضائع وقطع الغيار
 * تصنيف الكيان: 'company' (شركة مسحوبات), 'supplier' (مورد بضائع), 'both' (شركة ومورد - مقاصة ثنائية)
 */

const DEFAULT_COMPANIES = [
  { id: 'alwikaluh', name: 'alwikaluh', arName: 'الوكالة', entityType: 'both', persons: ['محمود الوكيل', 'مسؤول الوكالة'] },
  { id: 'mg-tech', name: 'MG Tech', arName: 'إم جي تك', entityType: 'both', persons: ['مسؤول إم جي'] },
  { id: 'compudata', name: 'Compudata', arName: 'كمبيوداتا', entityType: 'both', persons: ['كريم كمبيوداتا', 'مسؤول كمبيوداتا'] },
  { id: 'tecnology-world', name: 'Tecnology World', arName: 'عالم التكنولوجيا', entityType: 'both', persons: ['مسؤول التكنولوجيا'] },
  { id: 'al-hijaz', name: 'al-hijaz', arName: 'الحجاز', entityType: 'both', persons: ['مسؤول الحجاز'] },
  { id: 'dream-tech', name: 'Dream Tech', arName: 'دريم تك', entityType: 'both', persons: ['مسؤول دريم'] },
  { id: 'dr-mobile', name: 'DR-Mobile', arName: 'دكتور موبايل', entityType: 'both', persons: ['مسؤول دكتور موبايل'] },
  { id: 'star-tech', name: 'Star Tech', arName: 'ستار تك', entityType: 'both', persons: ['فني الصيانة', 'مسؤول ستار تك'] },
  { id: 'computer-city', name: 'Computer City', arName: 'كمبيوتر سيتي', entityType: 'both', persons: ['مسؤول كمبيوتر سيتي'] },
  { id: 'green', name: 'Green', arName: 'جرين', entityType: 'both', persons: ['مسؤول جرين'] },
  { id: 'pro-vision', name: 'Pro Vision', arName: 'برو فيجن', entityType: 'both', persons: ['مسؤول برو فيجن'] },
  { id: 'premium', name: 'Premium', arName: 'بريميوم', entityType: 'both', persons: ['مسؤول بريميوم'] },
  { id: 'access', name: 'Access', arName: 'أكسيس', entityType: 'both', persons: ['مسؤول أكسيس'] },
  { id: 'express', name: 'Express', arName: 'إكسبريس', entityType: 'both', persons: ['مسؤول إكسبريس'] },
  { id: 'al-nahaa', name: 'al-nahaa', arName: 'النهى', entityType: 'both', persons: ['مسؤول النهى'] },
  { id: 'al-sanaa', name: 'al-sanaa', arName: 'السناء', entityType: 'both', persons: ['مسؤول السناء'] },
  { id: 'al-watania', name: 'al-watania', arName: 'الوطنية', entityType: 'both', persons: ['مسؤول الوطنية'] },
  { id: 'campeonil', name: 'Campeonil', arName: 'كامبيونيل', entityType: 'both', persons: ['مسؤول كامبيونيل'] },
  { id: 'hamza', name: 'Hamza', arName: 'حمزة', entityType: 'both', persons: ['مسؤول حمزة'] },
  { id: 'al-mutahida', name: 'al-mutahida', arName: 'المتحدة', entityType: 'both', persons: ['مسؤول المتحدة'] },
  { id: 'river', name: 'River', arName: 'ريفر', entityType: 'both', persons: ['مسؤول ريفر'] },
  { id: 'future', name: 'Future', arName: 'فيوتشر', entityType: 'both', persons: ['مسؤول فيوتشر'] },
  { id: 'ultra', name: 'Ultra', arName: 'ألترا', entityType: 'both', persons: ['مسؤول ألترا'] },
  { id: 'notebook', name: 'NoteBook', arName: 'نوت بوك', entityType: 'both', persons: ['مسؤول نوت بوك'] },
  { id: 'master-tech', name: 'Master Tech', arName: 'ماستر تك', entityType: 'both', persons: ['مسؤول ماستر تك'] },
  { id: 'sky', name: 'Sky', arName: 'سكاي', entityType: 'both', persons: ['مسؤول سكاي'] },
  { id: 'm-tech', name: 'M Tech', arName: 'إم تك', entityType: 'both', persons: ['مسؤول إم تك'] },
  { id: 'janah', name: 'janah', arName: 'جناح', entityType: 'both', persons: ['مسؤول جناح'] },
  { id: 'al-asil', name: 'al-asil', arName: 'الأصيل', entityType: 'both', persons: ['مسؤول الأصيل'] },
  { id: 'alpha', name: 'Alpha', arName: 'ألفا', entityType: 'both', persons: ['مسؤول ألفا'] },
  { id: 'radio', name: 'Radio', arName: 'راديو', entityType: 'both', persons: ['مسؤول راديو'] }
];

window.DEFAULT_COMPANIES = DEFAULT_COMPANIES;
