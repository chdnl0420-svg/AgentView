// Sanity check for PATH_RE in src/renderer/lib/userMessage.ts
const PATH_RE =
  /(?:"[A-Za-z]:[\\/][^"\n]+"|'[A-Za-z]:[\\/][^'\n]+'|`[A-Za-z]:[\\/][^`\n]+`|"\/[^"\n]+"|'\/[^'\n]+'|`\/[^`\n]+`|[A-Za-z]:\\[\w\-./\\]*\w|[A-Za-z]:\/[\w\-./]*\w|(?<!:)\/[\w\-./]*\w|~\/[\w\-./]*\w|\.\.?\/[\w\-./]*\w)(?=$|[\s"'`)\]},.;:!?])/g;

const cases = [
  ['win abs + period',       'open C:\\Users\\foo\\bar.txt.'],
  ['rel + period',           'check ./src/index.ts.'],
  ['quoted win + korean',    'check "D:\\Project\\한글 폴더\\file.txt" here'],
  ['posix + comma',          '여기 /usr/local/bin/foo, then continue'],
  ['rel parent + colon',     'open ../config.json: now'],
  ['home + paren',           'see ~/foo/bar (later)'],
  ['no path',                'no path here, just text.'],
  ['url not path',           'visit https://example.com/foo'],
  ['posix + close paren',    'try (/var/log/syslog) now'],
  ['quoted posix + space',   'open \'/Users/foo bar/baz.txt\' please'],
  ['win quoted backtick',    'open `D:\\some path\\file.md` ok'],
  ['win unquoted no spaces', 'open D:\\foo\\bar.txt now'],
  ['end of string',          'see /etc/hosts'],
];

for (const [name, c] of cases) {
  const matches = [...c.matchAll(PATH_RE)].map((m) => m[0]);
  console.log(name.padEnd(26), '|', JSON.stringify(c), '->', matches);
}

// HARD_DROP test
const HARD = [
  /^Continue from where you left off\.?\s*$/im,
  /\bContinue from where you left off\b/i,
];
const samples = [
  'Continue from where you left off.',
  'Continue from where you left off',
  '  Continue from where you left off  ',
  'hello\nContinue from where you left off.\nbye',
  'Please continue from where we discussed', // negative
];
console.log('\n-- HARD_DROP --');
for (const s of samples) {
  const hit = HARD.some((re) => re.test(s));
  console.log(hit ? 'DROP' : 'KEEP', '|', JSON.stringify(s));
}
