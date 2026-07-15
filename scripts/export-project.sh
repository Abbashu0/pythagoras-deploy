#!/bin/bash
# export-project.sh — أنشئ أرشيف مضغوط للمشروع (بدون node_modules وملفات كبيرة)
#
# الناتج: /home/z/my-project/download/pythagoras-source-<timestamp>.zip
# الحجم المتوقع: ~10-30MB (بدلاً من 1.5GB)
#
# ما الذي يُضمَّن:
#   ✓ src/ — كل كود React/Next.js
#   ✓ public/pythagoras/ — تطبيق الطالب (vanilla JS)
#   ✓ prisma/ — مخطط قاعدة البيانات
#   ✓ package.json + bun.lock — التبعيات
#   ✓ next.config.ts + tsconfig.json — الإعدادات
#   ✓ tailwind.config.ts + postcss.config.mjs
#   ✓ .env (إذا وُجد)
#   ✓ Caddyfile
#
# ما الذي يُستبعد:
#   ✗ node_modules/ — 1.2GB (يُعاد تثبيتها بـ npm install)
#   ✗ .next/ — build artifacts
#   ✗ download/ — الملفات المنزّلة سابقاً
#   ✗ upload/ — الصور المرفوعة
#   ✗ skills/ — مهارات المنصة (ليست جزءاً من المشروع)
#   ✗ agent-ctx/ — سياق المساعد
#   ✗ tool-results/ — نتائج الأدوات
#   ✗ examples/ — أمثلة المنصة
#   ✗ dev.log — سجل التطوير
#   ✗ git history (.git/) — يمكن إضافته إذا أردت

set -e
cd /home/z/my-project

TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
OUTPUT="/home/z/my-project/download/pythagoras-source-$TIMESTAMP.zip"

echo "═══════════════════════════════════════════════"
echo "  تصدير مشروع فيثاغورس — $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════"
echo ""

# تأكد من وجود مجلد download
mkdir -p /home/z/my-project/download

# أنشئ الأرشيف
echo "📦 جارٍ إنشاء الأرشيف..."
rm -f "$OUTPUT"

zip -r -q "$OUTPUT" . \
  -x "node_modules/*" \
  -x ".next/*" \
  -x "download/*" \
  -x "upload/*" \
  -x "skills/*" \
  -x "agent-ctx/*" \
  -x "tool-results/*" \
  -x "examples/*" \
  -x "mini-services/*" \
  -x "db/*" \
  -x "dev.log" \
  -x "dev.log.*" \
  -x "pythagoras-server.log" \
  -x "*.pid" \
  -x "scripts/autosave.pid" \
  -x "scripts/autosave.log" \
  -x ".git/*" \
  2>&1 | tail -5

# اعرض النتيجة
SIZE=$(du -h "$OUTPUT" | cut -f1)
FILES=$(unzip -l "$OUTPUT" 2>/dev/null | tail -1 | awk '{print $2}')

echo ""
echo "✅ تم إنشاء الأرشيف بنجاح!"
echo ""
echo "📄 الملف: $OUTPUT"
echo "📊 الحجم: $SIZE"
echo "📁 عدد الملفات: $FILES"
echo ""
echo "═══════════════════════════════════════════════"
echo "  طريقة الاستخدام على جهازك:"
echo "═══════════════════════════════════════════════"
echo ""
echo "  1. فك ضغط الأرشيف:"
echo "     unzip pythagoras-source-$TIMESTAMP.zip -d pythagoras"
echo ""
echo "  2. ادخل المجلد:"
echo "     cd pythagoras"
echo ""
echo "  3. ثبّت التبعيات:"
echo "     npm install   # أو: bun install"
echo ""
echo "  4. شغّل خادم التطوير:"
echo "     npm run dev"
echo ""
echo "  5. افتح المتصفح على:"
echo "     http://localhost:3000"
echo ""
