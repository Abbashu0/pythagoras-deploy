import type { ChatLayoutTestCase, ChatTurn } from './chat-types';

export type { ChatLayoutTestCase } from './chat-types';

export interface Agent1DevelopmentRecentFixture {
  id: string;
  title: string;
  timeLabel: string;
  testCase: ChatLayoutTestCase;
}

const DEVELOPMENT_RECENTS: readonly Agent1DevelopmentRecentFixture[] = [
  { id: 'recent-biology', title: 'شرح انقسام الخلية', timeLabel: 'اليوم', testCase: 'biology' },
  { id: 'recent-math', title: 'أمثلة على التكامل', timeLabel: 'أمس', testCase: 'math' },
  { id: 'recent-table', title: 'مقارنة مراحل الانقسام', timeLabel: 'معاينة', testCase: 'table' },
  { id: 'recent-scroll', title: 'اختبار الإجابة الطويلة', timeLabel: 'معاينة', testCase: 'scroll' },
  { id: 'recent-stream', title: 'اختبار البث أثناء التمرير', timeLabel: 'معاينة', testCase: 'stream' },
];

export function getAgent1DevelopmentRecents(): readonly Agent1DevelopmentRecentFixture[] {
  return DEVELOPMENT_RECENTS;
}

const SCROLL_PARAGRAPH =
  'يعرض هذا النص الطويل عدة فقرات عربية متتابعة كي نتحقق من أن React Native يقيس الارتفاع الكامل للرد، وأن موضع أزرار النسخ والتفاعل وإعادة الإنشاء يبقى بعد نهاية المحتوى لا في منتصفه. يجب أن تظل الأسطر قابلة للوصول بالتمرير الطبيعي، وأن تبقى المسافة الأخيرة واضحة فوق حقل الكتابة المثبت أسفل الشاشة.';

const WIDE_COMPARISON_TABLE = [
  '| وجه المقارنة | Interphase | Prophase | Metaphase | Anaphase | Telophase |',
  '| --- | --- | --- | --- | --- | --- |',
  '| المادة الوراثية | تتضاعف في $S$ | تتكثف | تصطف | تنفصل | تصل إلى القطبين |',
  '| موضع الكروموسومات | داخل النواة | تبدأ بالحركة | منتصف الخلية | نحو القطبين | نواتان جديدتان |',
  '| المجموعة | $2n$ | $2n$ | $2n$ | $2n$ | $2n$ لكل خلية بنت |',
  '| المصطلح | English | شرح عربي | $2n \\rightarrow 2n$ | خلية أم | خليتان بنتان |',
].join('\n');

const BIOLOGY_CONTENT = [
  '# اختبار شرح الأحياء الطويل',
  '',
  'تنتظم دورة الخلية في مراحل مترابطة. نبدأ بمرحلة **Interphase**، ثم يحدث الانقسام وتوزيع المادة الوراثية مع المحافظة على تسلسل الخطوات.',
  '',
  '## المرحلة التمهيدية',
  '',
  ...Array.from({ length: 10 }, (_, index) =>
    `الفقرة ${index + 1}: قبل الانقسام تتضاعف المادة الوراثية ويستعدّ مركز الخلية للحركة. تظهر الكروموسومات تدريجيًا، وتبدأ البنية النووية بالتغير، لذلك نقرأ كل مرحلة بوصفها جزءًا من ترتيب زمني لا قائمة مصطلحات منفصلة.`,
  ),
  '',
  '## ترتيب الأحداث',
  '',
  '1. تتضاعف المادة الوراثية في مرحلة $S$ من Interphase.',
  '2. تصطف الكروموسومات في منتصف الخلية خلال Metaphase.',
  '3. تنفصل الكروماتيدات وتتجه إلى القطبين.',
  '4. تتكون خليتان جديدتان تحمل كل منهما مجموعة $2n$.',
  '',
  '> تذكّر أن الترتيب الزمني يساعد على تفسير سبب ظهور كل بنية في موضعها.',
  '',
  '## مقارنة مختصرة',
  '',
  WIDE_COMPARISON_TABLE,
  '',
  'حرّك الجدول أفقيًا لقراءة الأعمدة الأخيرة؛ يبقى تمرير بقية المحادثة عموديًا.',
  '',
  ...Array.from({ length: 4 }, (_, index) =>
    `مراجعة ${index + 1}: في Mitosis تنتقل نسخة متطابقة من المادة الوراثية إلى كل خلية بنت، بينما تختلف المراحل في شكل الكروموسومات وموقعها.`,
  ),
].join('\n');

const MATH_CONTENT = [
  '# اختبار قراءة الرياضيات',
  '',
  'إذا كان ثابت التكامل هو $C$، وكانت المعادلة $x=b$، فتبقى الرموز الرياضية داخل السطر العربي في موضعها.',
  '',
  'الصيغة البديلة المكافئة: \\(x=b\\). أمّا المصدر الخام `\\int` في الشيفرة فيبقى حرفيًا.',
  '',
  '## تكامل محدد',
  '',
  '$$',
  '\\int_0^2 x\\,dx = \\left[\\frac{x^2}{2}\\right]_0^2 = 2',
  '$$',
  '',
  ...Array.from({ length: 10 }, (_, index) =>
    `المثال ${index + 1}: نستخدم قاعدة القوة ثم نتحقق من النتيجة بالتعويض في الطرفين.`,
  ),
  '',
  '$$',
  '\\frac{d}{dx}x^3 = 3x^2',
  '$$',
  '',
  '$$',
  '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix} \\qquad f(x)=\\begin{cases}x^2&x>0\\\\0&x\\le 0\\end{cases}',
  '$$',
].join('\n');

const SCROLL_CONTENT = [
  '# اختبار ارتفاع transcript الطويل',
  '',
  'هذه إجابة تطويرية ثابتة لا ترسل أي طلب إلى Agent 1. الغرض منها فحص التمرير والارتفاع مع محتوى طويل ومنسق داخل شاشة المحادثة نفسها.',
  '',
  '## شرح الفكرة الأساسية',
  '',
  ...Array.from({ length: 12 }, (_, index) => `الفقرة ${index + 1}: ${SCROLL_PARAGRAPH}`),
  '',
  '## صيغ رياضية ضمن الشرح',
  '',
  'تظهر هنا معادلات قصيرة داخل السطر مثل $F(x)$ و$x^3$ و$3x^2$ مع بقاء الشرح العربي خارج حدود LaTeX.',
  '',
  '$$',
  '\\int_0^2 x\\,dx = \\left[\\frac{x^2}{2}\\right]_0^2 = 2',
  '$$',
  '',
  'وتبقى المعادلة التالية في كتلة مستقلة، ثم يستمر النص بعدها ضمن تدفق المستند نفسه:',
  '',
  '$$',
  '\\frac{d}{dx}x^3 = 3x^2',
  '$$',
  '',
  '## قائمة خطوات التحقق',
  '',
  '- يبدأ المحتوى تحت أدوات الرجوع والقائمة.',
  '- يلتف النص العربي بمحاذاة RTL الصحيحة.',
  '- تظهر الصيغ اللاتينية في مواضعها الطبيعية.',
  '- تظل كل فقرة قابلة للوصول عند السحب للأعلى والأسفل.',
  '- تبقى أزرار المساعد بعد آخر سطر من الرد.',
  '- تظل المسافة النهائية فوق Composer كافية وواضحة.',
  '',
  '## جدول الحالات',
  '',
  WIDE_COMPARISON_TABLE,
  '',
  'حرّك الجدول أفقيًا؛ لا ينبغي أن يوسّع هذا الحركة الأفقية إلى بقية الرد.',
  '',
  ...Array.from({ length: 5 }, (_, index) => `فقرة متابعة ${index + 1}: ${SCROLL_PARAGRAPH}`),
  '',
  '## القسم الأخير للاختبار',
  '',
  'إذا وصلت إلى هذا العنوان بعد التمرير، فتابع حتى نهاية الفقرة والمعادلة. يجب أن يظهر صف الإجراءات بعدهما مباشرة، ثم تبقى مساحة مريحة قبل Composer، من دون أن يختفي أي جزء خلفه.',
  '',
  '$$',
  'F(x) = \\int_0^x 3t^2\\,dt = x^3',
  '$$',
].join('\n');

export function createChatLayoutTestTurn(testCase: ChatLayoutTestCase): ChatTurn {
  const fixtureId = `development-${testCase}-layout-test`;
  const userContent = {
    short: 'مرحبا كيف الحال',
    biology: 'اشرح انقسام الخلية بالتفصيل',
    math: 'اشرح التكامل مع أمثلة',
    table: 'اعرض جدول المقارنة العريض',
    scroll: 'اعرض اختبار transcript الطويل',
    stream: 'اختبر نمو الرد أثناء البث',
  }[testCase];
  const assistantContent = {
    short: 'أهلًا بك! أنا بخير، كيف أساعدك اليوم؟',
    biology: BIOLOGY_CONTENT,
    math: MATH_CONTENT,
    table: `## جدول مقارنة بعرض الهاتف\n\n${WIDE_COMPARISON_TABLE}\n\nحرّك الجدول أفقيًا للوصول إلى كل الأعمدة.`,
    scroll: SCROLL_CONTENT,
    stream: '',
  }[testCase];

  return {
    id: fixtureId,
    user: { id: `${fixtureId}-user`, role: 'user', content: userContent },
    assistantAttempt: 0,
    assistant: testCase === 'stream'
      ? null
      : { id: `${fixtureId}-assistant`, role: 'assistant', content: assistantContent },
    assistantStatus: testCase === 'stream' ? 'working' : 'completed',
    errorMessage: null,
  };
}

export function getChatLayoutStreamChunks(): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < SCROLL_CONTENT.length; offset += 360) {
    chunks.push(SCROLL_CONTENT.slice(offset, offset + 360));
  }
  return chunks;
}
