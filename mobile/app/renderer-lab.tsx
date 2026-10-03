import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Agent1EnrichedMarkdown from '@/ai/assistant-enriched-markdown.ios';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

const FENCE = String.fromCharCode(96).repeat(3);
const TICK = String.fromCharCode(96);

const LAB_CASES = [
  {
    title: 'A — Arabic first-strong paragraph',
    markdown:
      'هذه فقرة عربية خالصة لاختبار اتجاه القراءة والتفاف السطور. يجب أن تبقى الجملة العربية متماسكة، وأن ينتهي السطر القصير بمحاذاة الطرف الأيمن.',
  },
  {
    title: 'B — Arabic with one inline formula',
    markdown:
      'إذا كانت الدالة $F(x)$ قابلة للاشتقاق، فإن مشتقتها تمثل معدل التغير عند كل نقطة.',
  },
  {
    title: 'C — Arabic with multiple inline formulas',
    markdown:
      'إذا كانت $F(x)$ دالة، وكانت مشتقتها $f(x)$، فإن العلاقة بينهما تساعدنا على فهم التفاضل والتكامل بصورة واضحة.\n\nولتكن مشتقة الدالة $x^3$ هي $3x^2$، وهذا مثال بسيط على وجود أكثر من تعبير رياضي داخل النص العربي نفسه.',
  },
  {
    title: 'D — English with inline math',
    markdown:
      'If $F(x)$ is differentiable and $f(x)$ is its derivative, then both expressions should remain inline with the surrounding English text.',
  },
  {
    title: 'Arabic unordered and ordered lists',
    markdown:
      '- حساب المساحات والحجوم.\n- إيجاد المسافة من السرعة.\n- حساب الشغل في الفيزياء.\n\n1. نحدد الدالة $F(x)$.\n2. نحسب المشتقة $f(x)$.\n3. نتحقق من النتيجة $x^3$.',
  },
  {
    title: 'Markdown formatting and safe link',
    markdown: [
      '# Heading direction',
      '',
      '## عنوان عربي للاختبار',
      '',
      'نص **عريض** وآخر *مائل* ضمن الفقرة نفسها.',
      '',
      '[رابط HTTPS آمن](https://example.com)',
      '',
      '> اقتباس عربي يختبر موضع الحد والمحاذاة.',
      '',
      'Inline code: ' + TICK + 'const answer = 42' + TICK,
      '',
      FENCE + 'ts',
      'const derivative = (x: number) => 3 * x ** 2;',
      FENCE,
      '',
      '| النوع | الصيغة |',
      '| --- | --- |',
      '| عربي | $F(x)$ |',
      '| English | $f(x)$ |',
      '',
      '---',
      '',
      'معادلة مستقلة:',
      '',
      '$$',
      '\\int_0^2 x\\,dx = \\left[\\frac{x^2}{2}\\right]_0^2 = 2',
      '$$',
    ].join('\n'),
  },
  {
    title: 'Representative Agent 1 math regression corpus',
    markdown: [
      '### Fractions and roots',
      '',
      '$$',
      '\\frac{1}{1+\\frac{1}{x}} \\qquad \\sqrt[3]{x}',
      '$$',
      '',
      '### Matrices and cases',
      '',
      '$$',
      '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix} \\qquad f(x)=\\begin{cases}x^2&x>0\\\\0&x\\le0\\end{cases}',
      '$$',
      '',
      '### Derivatives, sums, and arrows',
      '',
      '$$',
      '\\frac{\\partial f}{\\partial x} \\qquad \\sum_{i=1}^{n} i \\qquad A\\xrightarrow{f}B',
      '$$',
      '',
      '### Sets, probability, and units',
      '',
      '$$',
      '\\mathbb{R} \\qquad \\Pr(A\\mid B)=\\frac{\\Pr(A\\cap B)}{\\Pr(B)} \\qquad \\mathrm{m\\,s^{-1}}',
      '$$',
      '',
      '### Chemistry and Arabic labels',
      '',
      '$$',
      '\\ce{H2O + CO2 -> H2CO3} \\qquad \\fbox{\\text{ذرة}}\\rightarrow\\fbox{\\text{نواة}}',
      '$$',
    ].join('\n'),
  },
] as const;

const MATH_SOURCE_DIAGNOSTICS = [
  {
    title: 'Arabic prose with $C$',
    markdown: 'ثابت التكامل هو $C$، ويُكتب خارج الشرح العربي كرمز رياضي.',
  },
  {
    title: 'Arabic prose with $x=b$',
    markdown: 'حل المعادلة $x=b$ ثم تحقق من قيمة المتغير.',
  },
  {
    title: 'Alternate inline delimiter \\(x=b\\)',
    markdown: 'الصيغة البديلة هي \\(x=b\\) وتُحوّل في نسخة العرض فقط.',
  },
  {
    title: 'Display math',
    markdown: '$$\n\\int_0^2 x\\,dx = 2\n$$',
  },
  {
    title: 'Escaped dollar signs',
    markdown: String.raw`النص الحرفي \$C\$ لا يمثل صيغة رياضية.`,
  },
  {
    title: 'Currency',
    markdown: 'السعر $20، ثم أصبح $30.',
  },
  {
    title: 'Math-like source inside inline code',
    markdown: 'يبقى `$x=b$` نصًا برمجيًا حرفيًا.',
  },
  {
    title: 'Raw TeX without delimiters',
    markdown: String.raw`المصدر الخام: \int u\,dv = uv - \int v\,du`,
  },
] as const;

const LATEX_ARABIC_DIAGNOSTICS = [
  {
    title: '1. \\text{ذرة}',
    markdown: '$$\n\\text{ذرة}\n$$',
  },
  {
    title: '2. \\mathrm{ذرة}',
    markdown: '$$\n\\mathrm{ذرة}\n$$',
  },
  {
    title: '3. \\operatorname{ذرة}',
    markdown: '$$\n\\operatorname{ذرة}\n$$',
  },
  {
    title: '4. Raw Arabic in math',
    markdown: '$$\nذرة\n$$',
  },
  {
    title: '5. \\fbox{\\text{ذرة}}',
    markdown: '$$\n\\fbox{\\text{ذرة}}\n$$',
  },
  {
    title: '6. Arabic text with arrow',
    markdown: '$$\n\\text{نواة} \\rightarrow \\text{ذرة}\n$$',
  },
  {
    title: 'Control. English text with arrow',
    markdown: '$$\n\\text{Atom} \\rightarrow \\text{Nucleus}\n$$',
  },
  {
    title: 'Fallback guard — Arabic math as readable source',
    markdown:
      '$$\n\\fbox{\\text{ذرة}}\\rightarrow\\fbox{\\text{نواة}}\n$$',
  },
] as const;

export default function RendererLabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const contentWidth = Math.max(0, width - insets.left - insets.right - 44);
  const titleStyle = useMemo(
    () => ({ color: palette.text, fontSize: 16, fontWeight: '600' as const }),
    [palette.text],
  );

  if (!__DEV__) return null;

  return (
    <SafeAreaView
      edges={['top', 'right', 'bottom', 'left']}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: 8,
          paddingBottom: 30,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          onPress={() => router.back()}
          style={{ alignSelf: 'flex-start', paddingVertical: 10 }}
        >
          <Text style={{ color: palette.accent }}>‹ Chat</Text>
        </Pressable>
        <Text style={{ color: palette.text, fontSize: 22, fontWeight: '700', marginBottom: 6 }}>
          Agent 1 rich renderer lab
        </Text>
        <Text style={{ color: palette.textSecondary, fontSize: 13, marginBottom: 20 }}>
          Development-only native rendering review. This route is hidden outside development builds.
        </Text>

        {LAB_CASES.map((item, index) => (
          <View
            key={item.title}
            style={{
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: palette.separator,
              paddingTop: index === 0 ? 0 : 16,
              marginBottom: 22,
            }}
          >
            <Text style={[titleStyle, { marginBottom: 10 }]}>{item.title}</Text>
            <Agent1EnrichedMarkdown
              messageId={'renderer-lab-' + index}
              content={item.markdown}
              streaming={false}
              contentWidth={contentWidth}
              palette={palette}
            />
          </View>
        ))}

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: palette.separator,
            paddingTop: 16,
            marginBottom: 22,
          }}
        >
          <Text style={[titleStyle, { fontSize: 18, marginBottom: 8 }]}>
            Math source / presentation diagnostics
          </Text>
          <Text style={{ color: palette.textSecondary, fontSize: 13, marginBottom: 16 }}>
            These exact fixtures distinguish delimited math from escaped or raw model text; no TeX is inferred.
          </Text>
          {MATH_SOURCE_DIAGNOSTICS.map((item, index) => (
            <View key={item.title} style={{ marginBottom: 16 }}>
              <Text style={[titleStyle, { marginBottom: 6 }]}>{item.title}</Text>
              <Agent1EnrichedMarkdown
                messageId={'renderer-lab-math-source-' + index}
                content={item.markdown}
                streaming={false}
                contentWidth={contentWidth}
                palette={palette}
              />
            </View>
          ))}
        </View>

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: palette.separator,
            paddingTop: 16,
            marginBottom: 22,
          }}
        >
          <Text style={[titleStyle, { fontSize: 18, marginBottom: 8 }]}>
            Arabic inside LaTeX diagnostics
          </Text>
          <Text style={{ color: palette.textSecondary, fontSize: 13, marginBottom: 16 }}>
            Independent display-math cases using the installed native RaTeX renderer.
          </Text>
          {LATEX_ARABIC_DIAGNOSTICS.map((item, index) => (
            <View key={item.title} style={{ marginBottom: 16 }}>
              <Text style={[titleStyle, { marginBottom: 6 }]}>{item.title}</Text>
              <Agent1EnrichedMarkdown
                messageId={'renderer-lab-latex-arabic-' + index}
                content={item.markdown}
                streaming={false}
                contentWidth={contentWidth}
                palette={palette}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
