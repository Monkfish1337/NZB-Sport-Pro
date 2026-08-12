// Source-type registry.
//
// Each source module exports:
//   {
//     type:        'prowlarr' | 'zilean' | 'knaben' | 'torznab' | ...
//     label:       'Display name shown in the GUI dropdown'
//     description: 'Short one-line hint shown under the form'
//     schema:      [{ name, label, type, required?, default?, placeholder?, hint? }, ...]
//                   types: 'text' | 'url' | 'secret' | 'csv' | 'number' | 'bool'
//     multiSearch: async (queries, sourceConfig, log) -> Array<candidate>
//     test:        async (sourceConfig, log) -> { ok, latencyMs, message, sample? }
//   }
//
// candidate shape (consistent across all source types):
//   {
//     infoHash: '40-hex',
//     title:    string,
//     size:     number (bytes),
//     seeders:  number (0 if not applicable),
//     indexer:  string (which inner indexer / source name),
//     magnetTrackers: string[] (optional),
//     publishDate: ISO string (optional),
//   }

const types = new Map();

function register(mod) {
  if (!mod || !mod.type) throw new Error('source module missing .type');
  types.set(mod.type, mod);
}

function get(type)   { return types.get(type) || null; }
function list()      { return Array.from(types.values()); }
function listTypes() { return Array.from(types.keys()); }

// Eager load known source types so the GUI's "Add source" dropdown is
// populated from process boot. Add new sources here.
register(require('./prowlarr'));
register(require('./zilean'));
register(require('./knaben'));
register(require('./therarbg'));
register(require('./bitsearch'));
register(require('./torznab'));

module.exports = { register, get, list, listTypes };
