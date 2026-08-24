#!/usr/bin/env node
'use strict';

const assert = require('assert');
const promotions = require('../lib/promotions');
const transform = require('../lib/transform');
const { buildTeamMatchesUrl } = require('../lib/sources/football-data');
const { buildNuvioCollections } = require('../lib/nuvio-collections');

const promo = promotions.all.find((item) => item.id === 'manutd');
assert.ok(promo, 'Manchester United promotion is registered');
assert.strictEqual(promo.isCustom, false, 'promotion is built in');
assert.deepStrictEqual(promo.source, { type: 'football-data', teamId: '66' });
assert.deepStrictEqual(
  promo.catalogs.map((catalog) => [catalog.id, catalog.name]),
  [
    ['manutd-upcoming', 'Man United Upcoming'],
    ['manutd-recent', 'Man United Recent'],
  ],
);

assert.strictEqual(
  buildTeamMatchesUrl({
    teamId: '66',
    dateFrom: '2026-07-25',
    dateTo: '2026-11-22',
    limit: 500,
  }),
  'https://api.football-data.org/v4/teams/66/matches?dateFrom=2026-07-25&dateTo=2026-11-22&limit=500',
  'team feed requests all competitions in the configured event window',
);

const raw = {
  id: 900066,
  utcDate: '2026-08-22T15:00:00Z',
  status: 'FINISHED',
  matchday: 2,
  competition: { id: 2021, name: 'Premier League', code: 'PL' },
  season: { startDate: '2026-08-01' },
  homeTeam: { id: 322, name: 'Hull City AFC', shortName: 'Hull City', crest: 'https://example.test/hull.png' },
  awayTeam: { id: 66, name: 'Manchester United FC', shortName: 'Man United', crest: 'https://crests.football-data.org/66.png' },
};
const event = transform.fromFootballData(raw, promo);
assert.strictEqual(event.id, 'manutd:900066');
assert.strictEqual(event.name, 'Hull City vs Man United');
assert.strictEqual(event.competition, 'Premier League');
assert.strictEqual(event.source.awayTeamId, '66');
assert.strictEqual(promo.includeEvent(event), true, 'keeps Manchester United fixtures');
assert.ok(
  promo.searchTitles(event).includes('EPL 2026 08 22 Hull City vs Manchester United'),
  'generates the observed competition/date/team release order',
);
assert.strictEqual(
  promo.searchTitles(event)[0],
  'EPL 2026 08 22 Hull City vs Manchester United',
  'prioritises the most precise football scene query for bounded providers',
);
assert.strictEqual(promo.uuMaxQueries, 4, 'limits UU fan-out for team fixtures');
assert.strictEqual(
  promo.includeEvent({ name: 'Hull City vs Manchester City' }),
  false,
  'rejects defensive non-United fixtures',
);
assert.strictEqual(
  promo.isRelevantStreamTitle(
    'EPL 2026 08 22 Hull City Vs Manchester United 1080p HDTV H264-DARKSPORT-FTP',
    event,
  ).ok,
  true,
  'accepts the observed EPL release naming pattern',
);
assert.strictEqual(
  promo.isRelevantStreamTitle(
    'EPL 2026 08 21 Hull City Vs Manchester United 1080p HDTV H264-DARKSPORT',
    event,
  ).ok,
  true,
  'accepts one-day timezone differences',
);
assert.strictEqual(
  promo.isRelevantStreamTitle(
    'EPL 2026 08 19 Hull City Vs Manchester United 1080p HDTV H264-DARKSPORT',
    event,
  ).ok,
  false,
  'rejects releases with the wrong fixture date',
);

const footballFolder = buildNuvioCollections({ origin: 'https://sss.example' })[0]
  .folders.find((folder) => folder.title === 'Football');
assert.ok(footballFolder, 'Football collection folder exists');
assert.ok(footballFolder.catalogSources.some((source) => source.catalogId === 'manutd-upcoming'));
assert.ok(footballFolder.catalogSources.some((source) => source.catalogId === 'manutd-recent'));

console.log('OK — Manchester United all-competitions catalogs and release matching verified.');
