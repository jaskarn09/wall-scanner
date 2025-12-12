const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const config = require(path.resolve(process.cwd(), 'postcss.config.js'));

(async () => {
  try {
    const input = fs.readFileSync(path.resolve(process.cwd(), 'src', 'index.css'), 'utf8');
    const result = await postcss(config.plugins).process(input, { from: 'src/index.css' });
    console.log('Processed CSS length:', result.css.length);
  } catch (err) {
    console.error('PostCSS processing failed:');
    console.error(err.stack || err.message || err);
    process.exit(1);
  }
})();
