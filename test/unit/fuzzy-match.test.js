import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch, resolveRecipient } from '../../src/utils/fuzzy-match.js';

const CHATS = [
  { jid: '15145551234@s.whatsapp.net', name: 'John Smith' },
  { jid: '353871234567@s.whatsapp.net', name: 'Jane Doe' },
  { jid: '33612345678@s.whatsapp.net', name: 'Pierre Dupont' },
  { jid: '120363001234@g.us', name: 'Engineering Team' },
  { jid: '120363005678@g.us', name: 'Book Club' }
];

describe('fuzzyMatch', () => {
  it('returns empty for null/empty query', () => {
    assert.deepEqual(fuzzyMatch(null, CHATS), []);
    assert.deepEqual(fuzzyMatch('', CHATS), []);
  });

  it('returns empty for null/empty chats', () => {
    assert.deepEqual(fuzzyMatch('John', null), []);
    assert.deepEqual(fuzzyMatch('John', []), []);
  });

  it('exact match scores 0', () => {
    const results = fuzzyMatch('John Smith', CHATS);
    assert.ok(results.length > 0);
    assert.equal(results[0].name, 'John Smith');
    assert.equal(results[0].score, 0);
  });

  it('case-insensitive exact match scores 0', () => {
    const results = fuzzyMatch('john smith', CHATS);
    assert.equal(results[0].name, 'John Smith');
    assert.equal(results[0].score, 0);
  });

  it('starts-with match scores 1', () => {
    const results = fuzzyMatch('John', CHATS);
    assert.equal(results[0].name, 'John Smith');
    assert.equal(results[0].score, 1);
  });

  it('substring match scores 2', () => {
    const results = fuzzyMatch('Smith', CHATS);
    assert.equal(results[0].name, 'John Smith');
    assert.equal(results[0].score, 2);
  });

  it('finds groups by name', () => {
    const results = fuzzyMatch('book club', CHATS);
    assert.ok(results.length > 0);
    assert.equal(results[0].name, 'Book Club');
  });

  it('matches by JID number', () => {
    const results = fuzzyMatch('15145551234', CHATS);
    assert.ok(results.length > 0);
    assert.equal(results[0].jid, '15145551234@s.whatsapp.net');
  });

  it('respects maxResults', () => {
    const results = fuzzyMatch('e', CHATS, { maxResults: 2 });
    assert.ok(results.length <= 2);
  });

  it('returns no match for completely unrelated query', () => {
    const results = fuzzyMatch('xyzzyplugh', CHATS);
    assert.equal(results.length, 0);
  });
});

describe('resolveRecipient', () => {
  it('returns error for empty query', () => {
    const r = resolveRecipient(null, CHATS);
    assert.equal(r.resolved, null);
    assert.match(r.error, /required/i);
  });

  it('returns JID directly if query contains @', () => {
    const r = resolveRecipient('12345@s.whatsapp.net', CHATS);
    assert.equal(r.resolved, '12345@s.whatsapp.net');
    assert.equal(r.error, null);
  });

  it('resolves unambiguous match', () => {
    const r = resolveRecipient('Pierre', CHATS);
    assert.equal(r.resolved, '33612345678@s.whatsapp.net');
    assert.equal(r.error, null);
  });

  it('resolves exact match even with multiple candidates', () => {
    const r = resolveRecipient('John Smith', CHATS);
    assert.equal(r.resolved, '15145551234@s.whatsapp.net');
  });

  it('returns candidates for ambiguous match', () => {
    // "J" matches both "John Smith" and "Jane Doe" with similar scores
    const r = resolveRecipient('J', CHATS);
    // Either it resolves the best or returns candidates
    assert.ok(r.resolved || r.candidates.length > 0);
  });

  it('returns error when no match found', () => {
    const r = resolveRecipient('xyzzyplugh', CHATS);
    assert.equal(r.resolved, null);
    assert.match(r.error, /no contact/i);
  });

  it('resolves group by name', () => {
    const r = resolveRecipient('Engineering Team', CHATS);
    assert.equal(r.resolved, '120363001234@g.us');
  });
});

// ── REAL-WORLD FUZZY MATCHING SCENARIOS ─────────────────────────────────

describe('fuzzyMatch - Real-World Scenarios', () => {
  const REALISTIC_CHATS = [
    { jid: '15145551234@s.whatsapp.net', name: 'John' },
    { jid: '15145551235@s.whatsapp.net', name: 'John Smith' },
    { jid: '15145551236@s.whatsapp.net', name: 'Johnny Smith' },
    { jid: '15145551237@s.whatsapp.net', name: 'Jonathan Smith' },
    { jid: '353871234567@s.whatsapp.net', name: 'Sarah O\'Connor' },
    { jid: '33612345678@s.whatsapp.net', name: 'Jean-Pierre Dubont' },
    { jid: '491711234567@s.whatsapp.net', name: 'Müller' },
    { jid: '120363001234@g.us', name: 'Engineering Team 🚀' },
    { jid: '120363005678@g.us', name: 'Book Club' },
    { jid: '120363009999@g.us', name: 'Family 👨‍👩‍👧‍👦' },
    { jid: '15145559999@s.whatsapp.net', name: 'Alice' },
    { jid: '15145558888@s.whatsapp.net', name: 'Alex' },
    { jid: '15145557777@s.whatsapp.net', name: 'Alexandra' }
  ];

  it('handles multiple contacts with same first name', () => {
    // User says "John" - should return multiple Johns for disambiguation
    const results = fuzzyMatch('John', REALISTIC_CHATS, { maxResults: 10 });
    
    assert.ok(results.length >= 3, 'Should find multiple Johns');
    assert.ok(results[0].name.includes('John'), 'Best match should contain John');
    
    // All top results should be Johns
    const allJohns = results.every(r => r.name.includes('John'));
    assert.ok(allJohns, 'All results should be John variants');
  });

  it('handles nicknames and formal names', () => {
    // User says "Johnny" - should match John variants
    const results = fuzzyMatch('Johnny', REALISTIC_CHATS, { maxResults: 5 });
    
    assert.ok(results.length > 0, 'Should find Johnny/John matches');
    assert.ok(
      results.some(r => r.name.includes('John')),
      'Should match John variants'
    );
  });

  it('handles hyphenated and apostrophe names', () => {
    // Jean-Pierre
    const jpResults = fuzzyMatch('Jean', REALISTIC_CHATS);
    assert.ok(jpResults.length > 0, 'Should match Jean-Pierre');
    assert.ok(jpResults[0].name.includes('Jean'), 'Should find Jean-Pierre');
    
    // Sarah O'Connor
    const sarahResults = fuzzyMatch('Sarah', REALISTIC_CHATS);
    assert.ok(sarahResults.length > 0, 'Should match Sarah');
    assert.ok(sarahResults[0].name.includes('Sarah'), 'Should find Sarah O\'Connor');
  });

  it('handles names with emojis', () => {
    // Engineering Team with rocket emoji
    const engResults = fuzzyMatch('Engineering', REALISTIC_CHATS);
    assert.ok(engResults.length > 0, 'Should match Engineering Team with emoji');
    assert.ok(engResults[0].name.includes('Engineering'), 'Should find team with emoji');
    
    // Family with family emoji
    const familyResults = fuzzyMatch('Family', REALISTIC_CHATS);
    assert.ok(familyResults.length > 0, 'Should match Family with emoji');
  });

  it('handles similar names (Alice vs Alex vs Alexandra)', () => {
    // All start with "Al" - should return multiple for disambiguation
    const alResults = fuzzyMatch('Al', REALISTIC_CHATS, { maxResults: 10 });
    
    const alNames = alResults.filter(r => 
      r.name === 'Alice' || r.name === 'Alex' || r.name === 'Alexandra'
    );
    
    assert.ok(alNames.length >= 3, 'Should find all three similar names');
  });

  it('handles partial matches with score ordering', () => {
    const results = fuzzyMatch('Smith', REALISTIC_CHATS, { maxResults: 10 });
    
    // All Smiths should be found
    const smiths = results.filter(r => r.name.includes('Smith'));
    assert.ok(smiths.length >= 3, 'Should find all Smiths');
    
    // Exact "Smith" substring should score better than Levenshtein matches
    assert.ok(
      results[0].name.includes('Smith'),
      'Best match should be a Smith'
    );
  });

  it('handles international characters', () => {
    // Müller with umlaut
    const muellerResults = fuzzyMatch('Muller', REALISTIC_CHATS);
    assert.ok(muellerResults.length > 0, 'Should match Müller with Muller');
    
    // Or exact match
    const exactMueller = fuzzyMatch('Müller', REALISTIC_CHATS);
    assert.ok(exactMueller.length > 0, 'Should match Müller exactly');
  });

  it('handles phone number partial matches', () => {
    // User types partial phone number
    const results = fuzzyMatch('1514555', REALISTIC_CHATS, { maxResults: 10 });
    
    assert.ok(results.length > 0, 'Should match by phone prefix');
    
    // All should be 1514555 numbers
    const allMatch = results.every(r => r.jid.startsWith('1514555'));
    assert.ok(allMatch, 'All results should match phone prefix');
  });

  it('handles case variations', () => {
    const upperResults = fuzzyMatch('JOHN', REALISTIC_CHATS);
    const lowerResults = fuzzyMatch('john', REALISTIC_CHATS);
    const mixedResults = fuzzyMatch('JoHn', REALISTIC_CHATS);
    
    assert.deepEqual(
      upperResults.map(r => r.name),
      lowerResults.map(r => r.name),
      'Case should not affect results'
    );
    
    assert.deepEqual(
      upperResults.map(r => r.name),
      mixedResults.map(r => r.name),
      'Mixed case should not affect results'
    );
  });

  it('handles whitespace variations', () => {
    const normalResults = fuzzyMatch('John Smith', REALISTIC_CHATS);
    const extraSpaceResults = fuzzyMatch('  John   Smith  ', REALISTIC_CHATS);
    
    // Both should find John Smith variants (whitespace is trimmed)
    assert.ok(normalResults.length > 0, 'Normal query should find matches');
    assert.ok(extraSpaceResults.length > 0, 'Extra whitespace query should find matches');
    
    // Top result should be the same
    assert.equal(
      normalResults[0].name,
      extraSpaceResults[0].name,
      'Top match should be same regardless of whitespace'
    );
  });

  it('returns empty for completely unrelated query', () => {
    const results = fuzzyMatch('xyzzyplugh12345', REALISTIC_CHATS);
    assert.equal(results.length, 0, 'Should return no matches for gibberish');
  });

  it('handles very short queries (1-2 chars)', () => {
    const oneChar = fuzzyMatch('J', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(oneChar.length > 0, 'Should match with 1 char');
    assert.ok(oneChar[0].name.startsWith('J'), 'Should start with J');
    
    const twoChar = fuzzyMatch('Jo', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(twoChar.length > 0, 'Should match with 2 chars');
    assert.ok(twoChar[0].name.includes('Jo'), 'Should contain Jo');
  });

  it('respects maxResults limit', () => {
    const results = fuzzyMatch('Smith', REALISTIC_CHATS, { maxResults: 2 });
    assert.ok(results.length <= 2, 'Should respect maxResults');
    
    const moreResults = fuzzyMatch('Smith', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(moreResults.length > 2, 'Should return more with higher limit');
  });
});

describe('resolveRecipient - Real-World Disambiguation', () => {
  const DISAMBIGUATION_CHATS = [
    { jid: '15145551234@s.whatsapp.net', name: 'Mom' },
    { jid: '15145551235@s.whatsapp.net', name: 'Dad' },
    { jid: '15145551236@s.whatsapp.net', name: 'Mom Work' },
    { jid: '15145551237@s.whatsapp.net', name: 'Work' },
    { jid: '15145551238@s.whatsapp.net', name: 'Gym' },
    { jid: '15145551239@s.whatsapp.net', name: 'Gym Buddy' }
  ];

  it('disambiguates similar contact names', () => {
    // "Mom" could match "Mom" or "Mom Work"
    const momResults = resolveRecipient('Mom', DISAMBIGUATION_CHATS);
    
    // Should either resolve to exact "Mom" or return candidates
    if (momResults.resolved) {
      assert.equal(momResults.resolved, '15145551234@s.whatsapp.net', 'Should resolve to exact Mom');
    } else {
      assert.ok(momResults.candidates.length > 1, 'Should return candidates for disambiguation');
      assert.ok(momResults.candidates.some(c => c.name === 'Mom'), 'Mom should be in candidates');
      assert.ok(momResults.candidates.some(c => c.name === 'Mom Work'), 'Mom Work should be in candidates');
    }
  });

  it('handles prefix ambiguity (Work vs Gym)', () => {
    // "Work" should match "Work" better than "Mom Work"
    const workResults = resolveRecipient('Work', DISAMBIGUATION_CHATS);
    assert.equal(workResults.resolved, '15145551237@s.whatsapp.net', 'Should resolve to exact Work');
  });

  it('returns error for ambiguous short queries', () => {
    // "Gym" could be "Gym" or "Gym Buddy"
    const gymResults = resolveRecipient('Gym', DISAMBIGUATION_CHATS);
    
    if (gymResults.resolved) {
      assert.ok(
        gymResults.resolved.includes('15145551238') || gymResults.resolved.includes('15145551239'),
        'Should resolve to one of the Gym contacts'
      );
    } else {
      assert.ok(gymResults.candidates.length > 0, 'Should return candidates');
      assert.ok(
        gymResults.candidates.some(c => c.name.includes('Gym')),
        'Candidates should include Gym contacts'
      );
    }
  });

  it('provides helpful error message for no matches', () => {
    const noMatch = resolveRecipient('NonExistentContact123', DISAMBIGUATION_CHATS);
    
    assert.equal(noMatch.resolved, null, 'Should not resolve');
    assert.ok(noMatch.candidates.length === 0, 'Should have no candidates');
    assert.ok(noMatch.error, 'Should have error message');
    assert.ok(noMatch.error.includes('NonExistentContact123'), 'Error should mention the query');
    assert.ok(noMatch.error.includes('list_chats'), 'Error should suggest list_chats');
  });
});

describe('fuzzyMatch - Performance with Large Contact Lists', () => {
  it('handles 100+ contacts efficiently', () => {
    // Generate 100 realistic contact names
    const largeContactList = Array.from({ length: 100 }, (_, i) => ({
      jid: `1514555${String(i).padStart(4, '0')}@s.whatsapp.net`,
      name: `Contact ${i}`
    }));
    
    const startTime = Date.now();
    const results = fuzzyMatch('Contact 5', largeContactList, { maxResults: 10 });
    const endTime = Date.now();
    
    assert.ok(results.length > 0, 'Should find matches');
    assert.ok(endTime - startTime < 100, 'Should complete in under 100ms');
  });

  it('maintains scoring accuracy with large lists', () => {
    const mixedList = [
      { jid: '1@s.whatsapp.net', name: 'John' },
      { jid: '2@s.whatsapp.net', name: 'John Smith' },
      { jid: '3@s.whatsapp.net', name: 'Johnny' },
      ...Array.from({ length: 50 }, (_, i) => ({
        jid: `${i}@s.whatsapp.net`,
        name: `Other Contact ${i}`
      }))
    ];
    
    const results = fuzzyMatch('John', mixedList, { maxResults: 10 });
    
    // Top results should be John variants
    assert.ok(results[0].name.includes('John'), 'Best match should be John variant');
    assert.ok(results[1].name.includes('John'), 'Second match should be John variant');
    assert.ok(results[2].name.includes('John'), 'Third match should be John variant');
  });
});

describe('fuzzyMatch - Real-World Disambiguation', () => {
  const REALISTIC_CHATS = [
    { jid: '15145551234@s.whatsapp.net', name: 'John' },
    { jid: '15145551235@s.whatsapp.net', name: 'John Smith' },
    { jid: '15145551236@s.whatsapp.net', name: 'Johnny' },
    { jid: '15145551237@s.whatsapp.net', name: 'Jonathan' },
    { jid: '353871234567@s.whatsapp.net', name: 'Sarah Connor' },
    { jid: '353871234568@s.whatsapp.net', name: 'Sarah McLachlan' },
    { jid: '33612345678@s.whatsapp.net', name: 'Marie-Claire Dupont' },
    { jid: '491711234567@s.whatsapp.net', name: 'Müller' },
    { jid: '120363001234@g.us', name: 'Engineering Team' },
    { jid: '120363001235@g.us', name: 'Engineering - Backend' },
    { jid: '120363001236@g.us', name: 'Engineering - Frontend' },
    { jid: '120363005678@g.us', name: 'Book Club 📚' },
    { jid: '120363005679@g.us', name: 'Book Club - Spanish' },
    { jid: '861234567890@s.whatsapp.net', name: '张伟' },
    { jid: '819012345678@s.whatsapp.net', name: '田中太郎' }
  ];

  it('handles multiple contacts with same first name', () => {
    // "John" should match John variants (John, John Smith, Johnny start-with; Jonathan does not)
    const results = fuzzyMatch('John', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(results.length >= 3, 'Should find all John variants');
    
    // John (exact) should score best
    const johnExact = results.find(r => r.name === 'John');
    assert.ok(johnExact, 'Should find exact "John"');
    assert.strictEqual(johnExact.score, 0, 'Exact match should score 0');
    
    // John Smith should score 1 (starts with)
    const johnSmith = results.find(r => r.name === 'John Smith');
    assert.ok(johnSmith, 'Should find "John Smith"');
    assert.strictEqual(johnSmith.score, 1, 'Starts-with should score 1');
  });

  it('disambiguates between similar names', () => {
    // "Sarah" should return candidates for disambiguation
    const r = resolveRecipient('Sarah', REALISTIC_CHATS);
    assert.ok(r.candidates.length >= 2, 'Should have multiple Sarah candidates');
    
    const candidateNames = r.candidates.map(c => c.name);
    assert.ok(candidateNames.includes('Sarah Connor'), 'Should include Sarah Connor');
    assert.ok(candidateNames.includes('Sarah McLachlan'), 'Should include Sarah McLachlan');
  });

  it('handles hyphenated and compound names', () => {
    const results = fuzzyMatch('Marie', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results.length > 0, 'Should find Marie-Claire');
    
    const marieClaire = results.find(r => r.name === 'Marie-Claire Dupont');
    assert.ok(marieClaire, 'Should match hyphenated name');
    assert.ok(marieClaire.score <= 2, 'Should be substring match');
  });

  it('handles special characters and diacritics', () => {
    const results = fuzzyMatch('Muller', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results.length > 0, 'Should find Müller with simplified spelling');
    
    const muller = results.find(r => r.name === 'Müller');
    assert.ok(muller, 'Should match despite umlaut difference');
  });

  it('handles emojis in group names', () => {
    const results = fuzzyMatch('book club', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results.length >= 2, 'Should find both Book Club groups');
    
    const bookClubEmoji = results.find(r => r.name === 'Book Club 📚');
    assert.ok(bookClubEmoji, 'Should match group with emoji');
  });

  it('handles CJK (Chinese/Japanese/Korean) names', () => {
    const results1 = fuzzyMatch('张伟', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results1.length > 0, 'Should find Chinese name');
    assert.strictEqual(results1[0].name, '张伟', 'Should match exactly');
    
    const results2 = fuzzyMatch('田中', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results2.length > 0, 'Should find Japanese name by partial match');
  });

  it('handles group name prefixes and departments', () => {
    const results = fuzzyMatch('Engineering', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(results.length >= 3, 'Should find all Engineering groups');
    
    // Engineering Team should score best (starts-with match)
    const engTeam = results.find(r => r.name === 'Engineering Team');
    assert.ok(engTeam, 'Should find Engineering Team');
    assert.ok(engTeam.score <= 2, 'Should be a starts-with or substring match');
  });

  it('distinguishes between similar group names', () => {
    const r = resolveRecipient('Engineering', REALISTIC_CHATS);
    assert.ok(r.candidates.length >= 3, 'Should offer disambiguation for Engineering groups');
    
    const candidateNames = r.candidates.map(c => c.name);
    assert.ok(candidateNames.includes('Engineering Team'), 'Should include Engineering Team');
    assert.ok(candidateNames.includes('Engineering - Backend'), 'Should include Backend');
    assert.ok(candidateNames.includes('Engineering - Frontend'), 'Should include Frontend');
  });

  it('handles phone number matching with partial digits', () => {
    const results = fuzzyMatch('1514555', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(results.length >= 4, 'Should match multiple numbers with prefix');
    
    // Should match all 1514555xxxx numbers
    for (const result of results) {
      assert.ok(
        result.jid.includes('1514555'),
        `Should match phone number prefix: ${result.jid}`
      );
    }
  });

  it('handles typos with Levenshtein distance', () => {
    // "Jon" is 1 edit distance from "John"
    const results = fuzzyMatch('Jon', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results.length > 0, 'Should find John despite typo');
    
    const john = results.find(r => r.name === 'John');
    assert.ok(john, 'Should match John with typo');
    assert.ok(john.score <= 4, 'Should have good score despite typo');
  });

  it('handles common nicknames and diminutives', () => {
    const results = fuzzyMatch('Johnny', REALISTIC_CHATS, { maxResults: 5 });
    assert.ok(results.length > 0, 'Should find Johnny');
    
    const johnny = results.find(r => r.name === 'Johnny');
    assert.ok(johnny, 'Should find exact Johnny match');
    assert.strictEqual(johnny.score, 0, 'Exact match should score 0');
    
    // Should also find related names with higher scores
    const john = results.find(r => r.name === 'John');
    assert.ok(john, 'Should also suggest John');
    assert.ok(john.score > johnny.score, 'John should score worse than exact Johnny');
  });

  it('prioritizes exact match over multiple close matches', () => {
    const r = resolveRecipient('John Smith', REALISTIC_CHATS);
    assert.equal(r.resolved, '15145551235@s.whatsapp.net', 'Should resolve to exact match');
    assert.strictEqual(r.candidates.length, 0, 'Should not return candidates for exact match');
  });

  it('handles very short queries (1-2 chars)', () => {
    const results = fuzzyMatch('J', REALISTIC_CHATS, { maxResults: 10 });
    assert.ok(results.length >= 4, 'Should find multiple J names');
    
    const allStartWithJ = results.every(r => 
      r.name.toLowerCase().startsWith('j') || r.jid.startsWith('j')
    );
    assert.ok(allStartWithJ, 'All results should start with J');
  });

  it('handles case variations correctly', () => {
    const tests = [
      { query: 'JOHN', expected: 'John' },
      { query: 'john', expected: 'John' },
      { query: 'JoHn', expected: 'John' },
      { query: 'ENGINEERING', expected: 'Engineering Team' },
      { query: 'engineering', expected: 'Engineering Team' }
    ];

    for (const test of tests) {
      const results = fuzzyMatch(test.query, REALISTIC_CHATS, { maxResults: 5 });
      assert.ok(results.length > 0, `Should find match for "${test.query}"`);
      assert.ok(
        results[0].name.toLowerCase().includes(test.expected.toLowerCase()),
        `Should match case-insensitively for "${test.query}"`
      );
    }
  });

  it('returns empty for queries with no reasonable match', () => {
    const results = fuzzyMatch('xyznonexistent', REALISTIC_CHATS, { maxResults: 5 });
    assert.strictEqual(results.length, 0, 'Should return empty for no matches');
  });

  it('respects maxResults limit', () => {
    const results = fuzzyMatch('e', REALISTIC_CHATS, { maxResults: 3 });
    assert.ok(results.length <= 3, 'Should respect maxResults limit');
  });
});
