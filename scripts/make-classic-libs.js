// make-classic-libs.js — 把 web\dist\ChoreoHelper\libs\ 下的 three.js ES 模块转成经典脚本
//
// 干嘛的：阶段 2「网页脱离插件启动」用 file:// 直接双击打开主页，但浏览器禁止
//        file:// 页面加载 ES 模块（import 会报 CORS），所以需要一套同源的经典
//        <script> 版库（libs-classic\），preview3d.js 在模块导入失败时兜底加载它们。
// 怎么跑：D:\nodejs\node.exe scripts\make-classic-libs.js
//        （要求 libs\ 里的 'three' 裸名导入已改成相对路径——本项目已改好）
// 产物：web\dist\ChoreoHelper\libs-classic\ 下 4 个文件，加载顺序必须是：
//        three → BufferGeometryUtils → SkeletonUtils → GLTFLoader
//        （后三个从 window.THREE 解构取名；GLTFLoader 还要用 BufferGeometryUtils 的导出）
// 升级 Three.js 时：libs\ 换新文件并重改相对导入后，重跑本脚本即可。
//
// 转换规则（机械替换，不改任何逻辑代码）：
//   1) 尾部/内联的 export {...} / export function 摘掉，把导出名挂到 window.THREE
//   2) 文件头 import {...} from '...' 换成 var {...} = window.THREE;（解构同名）
//   3) 每个产物加 'use strict'（ES 模块本身就是严格模式，保持语义一致）
//   4) 转完自检：产物里不允许再残留行首 import/export，否则报错退出

'use strict';
const fs = require('fs');
const path = require('path');

const LIBS = path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'libs');
const OUT = path.join(__dirname, '..', 'web', 'dist', 'ChoreoHelper', 'libs-classic');

// "A, B as C" → [{name:'A',as:'A'},{name:'B',as:'C'}]
function parseNames(raw) {
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (one) {
    const m = one.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (!m) throw new Error('导出/导入名单里有认不出的写法: "' + one + '"');
    return { name: m[1], as: m[2] || m[1] };
  });
}

function namesToLiteral(names) {
  return '{ ' + names.map(function (n) { return n.as === n.name ? n.name : n.as + ': ' + n.name; }).join(', ') + ' }';
}

// 转换单个库文件。isThree=true 时把导出做成 window.THREE 本体；否则追加挂到 window.THREE
// 注意：正文整体包在 IIFE 里——经典脚本共享全局作用域，three 顶层的 class/const 会跟
// 后续文件解构出来的同名 var 冲突（SyntaxError: already been declared，实测踩过）
function convert(relPath, isThree) {
  const src = fs.readFileSync(path.join(LIBS, relPath), 'utf8');
  let out = src;

  // 1) 摘掉所有行首 export {...}; 块（单行/多行都行；export 名单里没有嵌套大括号）
  const exported = [];
  out = out.replace(/^[ \t]*export[ \t]*\{([^}]*)\}[ \t]*;[ \t]*$/gm, function (_m, list) {
    parseNames(list).forEach(function (n) { exported.push(n); });
    return '';
  });

  // 2) 摘掉内联 export function/class/const/let/var，记录名字
  out = out.replace(/^[ \t]*export[ \t]+(?=(function|class|const|let|var)[ \t]+([\w$]+))/gm,
    function (_m, kw, name) { exported.push({ name: name, as: name }); return ''; });

  // 3) import {...} from '...'; → var {...} = window.THREE;（three 本体没有 import，不受影响）
  let importCount = 0;
  out = out.replace(/^[ \t]*import[ \t]*\{([^}]*)\}[ \t]*from[ \t]*['"][^'"]*['"][ \t]*;[ \t]*$/gm,
    function (_m, list) {
      importCount++;
      return 'var ' + namesToLiteral(parseNames(list)) + ' = window.THREE;';
    });

  // 4) 自检：不允许残留行首 import/export（换行/分号差异都算失败）
  const bad = out.match(/^[ \t]*(import|export)\b/m);
  if (bad) throw new Error(relPath + ' 转换后仍残留 ' + bad[1] + ' 语句——转换规则要更新');

  const head =
    (isThree
      ? '// three.classic.js — three.module.js 的经典脚本版（make-classic-libs.js 生成，勿手改）\n' +
        '// 加载后把全部导出挂到 window.THREE；供 file:// 离线场景使用，升级 three 后重新生成\n'
      : '// ' + path.basename(relPath) + ' 的经典脚本版（make-classic-libs.js 生成，勿手改）\n' +
        '// 依赖 three.classic.js 先加载（从 window.THREE 取名），导出回挂到 window.THREE\n');
  const tail = isThree
    ? 'window.THREE = ' + namesToLiteral(exported) + ';\n'
    : 'Object.assign(window.THREE, ' + namesToLiteral(exported) + ');\n';

  // IIFE 包裹：正文里的顶层声明全部落进函数作用域，跨文件不冲突、重复加载也安全；
  // 'use strict' 放函数内（ES 模块本身是严格模式，保持语义一致）
  const body = '(function () {\n\'use strict\';\n' + out.replace(/^\uFEFF/, '') + '\n' + tail + '})();\n';
  return { code: head + body, exported: exported.length, imports: importCount };
}

const files = [
  { rel: 'three.module.js', out: 'three.classic.js', isThree: true },
  { rel: 'utils/BufferGeometryUtils.js', out: 'BufferGeometryUtils.classic.js', isThree: false },
  { rel: 'utils/SkeletonUtils.js', out: 'SkeletonUtils.classic.js', isThree: false },
  { rel: 'loaders/GLTFLoader.js', out: 'GLTFLoader.classic.js', isThree: false },
];

fs.mkdirSync(OUT, { recursive: true });
files.forEach(function (f) {
  const r = convert(f.rel, f.isThree);
  const dst = path.join(OUT, f.out);
  fs.writeFileSync(dst, r.code, 'utf8');
  console.log(f.out + '  ' + r.code.length + ' 字节  导出 ' + r.exported + ' 名  import 转 ' + r.imports + ' 处');
});
console.log('完成。加载顺序：three → BufferGeometryUtils → SkeletonUtils → GLTFLoader');
