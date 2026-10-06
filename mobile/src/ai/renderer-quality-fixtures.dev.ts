const fence = String.fromCharCode(96).repeat(3);
const block = (language: string, code: string) => `${fence}${language}\n${code}\n${fence}`;
export const LONG_USER_FIXTURE = Array.from({ length: 26 }, (_, i) => `المطلب ${i + 1}: اشرح العلاقة بين API وTypeScript والمصطلح Newton's Second Law مع مثال عربي واضح، وحافظ على خطوات الحل كاملة.`).join('\n');
export const CHAT_QUALITY_CASES = [
  { title: 'Plain text fence', markdown: block('text', 'First line\n  Indented line\nآخر سطر') },
  { title: 'Python fence', markdown: block('python', 'def average(values):\n    return sum(values) / len(values)\n\nprint("مرحبا")') },
  { title: 'JSON fence', markdown: block('json', '{\n  "name": "Pi",\n  "message": "مرحبا",\n  "enabled": true\n}') },
  { title: 'TypeScript fence', markdown: block('typescript', 'type Student = { id: string; name: string };\nconst greet = (student: Student): string => `مرحبا ${student.name}`;') },
  { title: 'HTML fence', markdown: block('html', '<section class="lesson">\n  <article>\n    <h2>الدرس الأول</h2>\n  </article>\n</section>') },
  { title: 'Bash fence', markdown: block('bash', '#!/usr/bin/env bash\nprintf "%s\\n" "hello world"\nexport SUBJECT="physics"') },
  { title: 'Unknown language', markdown: block('custom-dsl', '  literal content\n`` inside a code line') },
  { title: 'No language', markdown: block('', 'Language-free text') },
  { title: 'Tabs + indentation + Unicode code', markdown: block('ts', '\tinterface Student {\n\t\tname: string; // مرحبا 👋\n\t}\n  const student = { name: "Pi" };  ') },
  { title: 'Empty code block', markdown: fence + 'python\n' + fence },
  { title: 'Long code line — 360 characters', markdown: block('ts', `const value = "${'abcdef'.repeat(60)}";`) },
  { title: 'Independent code blocks / final block', markdown: block('py', 'print(1)') + '\n\nنص بين كتلتين.\n\n' + block('json', '{"result": 2}') },
  { title: 'Wide display math — stress regression', markdown: '$$\nK=\\frac{1}{2}(2.5)(12)^2=\\frac{1}{2}(2.5)(144)=1.25\\times144=180\\,\\mathrm{J}\n$$' },
  { title: 'Extra-wide display math', markdown: '$$\n' + Array.from({ length: 18 }, (_, i) => `\\frac{x^{${i + 1}}}{${i + 2}}`).join('+') + '=F(x)+C\n$$' },
  { title: 'Normal centered equation', markdown: '$$\n\\int_0^2 x\\,dx=2\n$$' },
  { title: 'Inline bidi isolation', markdown: [
    'هذا المصطلح API مهم في التطبيق.', "ينص Newton's Second Law على العلاقة التالية.",
    'نستخدم DNA وRNA وATP داخل الأحياء.', 'يمكن قراءة JSON من TypeScript عبر API.',
    'This English paragraph must keep its original direction.', 'فقرة عربية تعود بعد الإنجليزية.',
    'نص مع `const API = 1` و[رابط API](https://example.com/API) ومعادلة $F(x)$.',
  ].join('\n\n') },
  { title: 'Wide RTL table — preserved', markdown: '| المقارنة | المفهوم الأول | المفهوم الثاني | المفهوم الثالث | المفهوم الرابع | المفهوم الخامس |\n| --- | --- | --- | --- | --- | --- |\n| وصف طويل للمقارنة | محتوى عربي طويل للخانة الأولى | محتوى عربي طويل للخانة الثانية | محتوى عربي طويل للخانة الثالثة | محتوى عربي طويل للخانة الرابعة | محتوى عربي طويل للخانة الخامسة |' },
] as const;
