const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const join = (...parts) => parts.join('');
const obsolete = [
  ['scripts', 'test-' + join('a','is','stream') + '.js'],
  ['scripts', 'test-fda-' + join('access','data') + '-parser.js'],
  ['src', 'services', join('a','is','stream') + '.js'],
  ['src', 'services', 'fda-' + join('access','data') + '.js'],
  ['src', 'services', 'fda-' + join('i','rr') + '.js'],
  ['src', 'services', 'fda-' + join('play','wright') + '.js'],
  ['src', 'services', 'fda-' + join('play','wright') + '-' + join('head','less') + '.js'],
  ['src', 'services', 'fda-' + join('q','lik') + '.js'],
  ['src', 'src', 'services', 'fda-' + join('play','wright') + '-' + join('head','less') + '.js'],
  ['src', 'src', 'services', 'fda-' + join('q','lik') + '.js']
];

let removed = 0;
for (const parts of obsolete) {
  const filePath = path.join(root, ...parts);
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      removed++;
      console.log('removed', path.relative(root, filePath));
    }
  } catch (err) {
    console.log('skip', path.relative(root, filePath), err.message);
  }
}
console.log(`Cleanup oficial completado. Archivos removidos: ${removed}`);
