const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, createSession } = require('./harness');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS  ${name}`); }
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}

function tree() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zfdi-'));
  // 40 PDFs: 10 at top level, 30 spread across 3 subfolders (10 each)
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(base, `top-${i}.pdf`), `top${i}`);
  for (const sub of ['2021', '2022', '2023']) {
    const d = path.join(base, sub);
    fs.mkdirSync(d);
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(d, `${sub}-${i}.pdf`), `${sub}-${i}`);
  }
  // noise the scanner must report, not hide
  fs.writeFileSync(path.join(base, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(base, 'sheet.csv'), 'x');
  fs.writeFileSync(path.join(base, 'archive.zip'), 'x');
  fs.writeFileSync(path.join(base, 'book.epub'), 'x');
  const deep = path.join(base, '2023', 'nested');
  fs.mkdirSync(deep);
  fs.writeFileSync(path.join(deep, 'deep.pdf'), 'deep');
  return base;
}

(async () => {
  console.log('\n1. baseline: every file found and imported');
  {
    const base = tree();
    const r = await run(base);
    // 40 pdfs + 1 nested pdf + 1 epub + 1 txt = 43 importable
    check('found/imported = 43', r.imported.length === 43, `got ${r.imported.length}`);
    check('summary reports Imported: 43', /Imported: 43/.test(r.summary), r.summary);
    check('reports 2 ignored files', /Ignored 2 unsupported/.test(r.summary), r.summary);
    check('mentions subcollections tip', /Show Items from Subcollections/.test(r.summary), r.summary);
    check('no unaccounted', !/Unaccounted/.test(r.summary), r.summary);
  }

  console.log('\n2. enumeration fails mid-folder (the original data-loss bug)');
  {
    const base = tree();
    const failEnum = new Map([[path.resolve(base, '2022'), { afterN: 4, times: 1 }]]);
    const r = await run(base, { failEnum });
    check('all 43 still imported after retry recovery', r.imported.length === 43, `got ${r.imported.length}`);
    check('recovery was logged', r.log.some(l => /Recovered a partial folder read/.test(l)));
    check('no silent shortfall in summary', /Imported: 43/.test(r.summary), r.summary);
  }

  console.log('\n3. permanently broken folder is reported, not hidden');
  {
    const base = tree();
    const failEnum = new Map([[path.resolve(base, '2022'), { afterN: 4, times: 99 }]]);
    const r = await run(base, { failEnum });
    check('partial folder surfaced in summary', /read partially/.test(r.summary), r.summary);
    check('4 of 10 recovered from broken folder', r.imported.length === 37, `got ${r.imported.length}`);
  }

  console.log('\n4. junction loop does not hang or overflow');
  {
    const base = tree();
    const loop = path.resolve(base, '2021', 'loop');
    fs.mkdirSync(loop);
    const links = new Map([[loop, path.resolve(base)]]);
    const r = await run(base, { links });
    check('completed without stack overflow', typeof r.summary === 'string');
    check('loop guard engaged', /link loop/.test(r.summary) || r.log.some(l => /Already visited/.test(l)), r.summary);
  }

  console.log('\n5. unreadable entry is counted, remaining files still import');
  {
    const base = tree();
    const raise = [path.resolve(base, 'top-3.pdf')];
    const r = await run(base, { raise });
    check('42 imported', r.imported.length === 42, `got ${r.imported.length}`);
    check('unreadable entry reported', /unreadable entry/i.test(r.summary), r.summary);
  }

  console.log('\n6. transient import failure is retried');
  {
    const base = tree();
    const r = await run(base, { failOnce: new Set(['top-5.pdf']) });
    check('retry recovered the file', r.imported.length === 43, `got ${r.imported.length}`);
    check('no failures in summary', /Failed: 0/.test(r.summary), r.summary);
  }

  console.log('\n7. hidden folder skipped but reported');
  {
    const base = tree();
    const r = await run(base, { hidden: [path.resolve(base, '2022')] });
    check('33 imported', r.imported.length === 33, `got ${r.imported.length}`);
    check('hidden folder reported', /hidden folder/.test(r.summary), r.summary);
  }

  console.log('\n8. re-importing the same folder skips duplicates, not files');
  {
    const base = tree();
    const s = createSession();
    const first = await s.importFolder(base);
    check('first pass imports 43', first.imported.length === 43, `got ${first.imported.length}`);

    const second = await s.importFolder(base);
    check('second pass imports 0', second.imported.length === 0, `got ${second.imported.length}`);
    check('second pass reports 43 duplicates', /Duplicates: 43/.test(second.summary), second.summary);
    check('no new collections created', !/Collections created/.test(second.summary), second.summary);
    check('subcollection tip still shown on reuse', /Show Items from Subcollections/.test(second.summary), second.summary);
  }

  console.log('\n9. duplicate index is built once per collection, not once per file');
  {
    const base = tree();
    const s = createSession();
    await s.importFolder(base);
    const second = await s.importFolder(base);
    // Five collections hold files: root, 2021, 2022, 2023, 2023/nested.
    check(
      'getChildItems called at most once per collection',
      second.counters.getChildItems <= 6,
      `called ${second.counters.getChildItems} times for 43 files`
    );
  }

  console.log('\n10. Gecko build without getNext() still enumerates');
  {
    const base = tree();
    const r = await run(base, { nextFileOnly: true });
    check('all 43 imported via nextFile', r.imported.length === 43, `got ${r.imported.length}`);
    check('no partial-read warning', !/read partially/.test(r.summary), r.summary);
  }

  console.log('\n11. every enumerator opened is closed');
  {
    const base = tree();
    const r = await run(base);
    check(
      'opened === closed',
      r.counters.enumeratorsOpened === r.counters.enumeratorsClosed,
      `opened ${r.counters.enumeratorsOpened}, closed ${r.counters.enumeratorsClosed}`
    );
  }

  console.log('\n12. plain-text and markup documents are imported, not ignored');
  {
    const base = tree();
    for (const name of ['readme.md', 'page.html', 'page.htm']) {
      fs.writeFileSync(path.join(base, name), 'x');
    }
    const r = await run(base);
    const names = r.imported.map(p => path.basename(p));
    for (const name of ['notes.txt', 'readme.md', 'page.html', 'page.htm']) {
      check(`imported ${name}`, names.includes(name), names.join(', '));
    }
    check('still ignores genuinely unsupported types', /Ignored 2 unsupported/.test(r.summary), r.summary);
  }

  console.log('\n13. linked mode records paths instead of copying');
  {
    const session = createSession();
    const base = tree();
    const r = await session.importFolder(base, { linked: true });

    check('nothing was copied into storage', r.imported.length === 0, `got ${r.imported.length}`);
    check('every file linked instead', r.linked.length === 43, `got ${r.linked.length}`);
    check('linked paths are the originals', r.linked.every(p => p.startsWith(base)), r.linked[0]);
    check('summary says originals were not copied', /originals were not copied/.test(r.summary), r.summary);
    check('collections still built', r.collectionNames.includes('2022'), r.collectionNames.join(', '));
  }

  console.log('\n14. re-linking the same folder detects duplicates');
  {
    const session = createSession();
    const base = tree();
    await session.importFolder(base, { linked: true });
    const second = await session.importFolder(base, { linked: true });

    check('no second link for any file', second.linked.length === 0, `got ${second.linked.length}`);
    check('reported as duplicates', /Duplicates: 43/.test(second.summary), second.summary);
  }

  console.log('\n15. linked mode is refused for group libraries');
  {
    const session = createSession();
    const base = tree();
    const group = session.groupCollection();
    const r = await session.importFolder(base, { linked: true, collection: group });

    check('nothing linked', r.linked.length === 0, `got ${r.linked.length}`);
    check('nothing imported either', r.imported.length === 0, `got ${r.imported.length}`);
    check('explains why', /only supported in My Library/.test(r.summary), r.summary);
  }

  console.log('\n16. copy mode into a group library still works');
  {
    const session = createSession();
    const base = tree();
    const group = session.groupCollection();
    const r = await session.importFolder(base, { collection: group });

    check('stored copies are allowed', r.imported.length === 43, `got ${r.imported.length}`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nALL PASS\n');
  process.exit(failures ? 1 : 0);
})();
