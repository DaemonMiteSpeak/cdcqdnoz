'use strict';
// "Switch roles" button in the pause menu of the FIRST client of a session.
//
// Minecraft 1.21.6+ lets a server add buttons to the pause screen: dialogs listed in the
// `minecraft:dialog` tag `pause_screen_additions` are shown there. A dialog button can carry a
// `minecraft:custom` action; the client answers it with a `custom_click_action` packet that the
// proxy intercepts (it never reaches the real server).
//
// Only the first client gets the extra registry entry + tag (the other client receives the server's
// own configuration unchanged), so the button exists for that player only, whatever role they have.
// Older versions (no dialogs) can use the chat command /switchroles from the same client.
const nbt = require('prismarine-nbt');

const MIN_PV = 771;                               // 1.21.6: dialogs
const DIALOG_REG = 'minecraft:dialog';
const DIALOG_TAG = 'minecraft:pause_screen_additions';
const KEY = 'hider:switch_roles';
const ACTION_ID = 'hider:switch_roles';
const COMMAND = 'switchroles';

const DIALOG = {
  type: 'minecraft:notice',
  title: { text: 'Switch roles' },
  external_title: { text: 'Switch roles' },
  body: { type: 'minecraft:plain_message', contents: { text: 'Swap the Manager and Observer roles with the other client?' }, width: 260 },
  can_close_with_escape: true,
  action: {
    label: { text: 'Switch roles' },
    width: 200,
    action: { type: 'minecraft:custom', id: ACTION_ID }
  }
};

function toNbt(v) {
  if (typeof v === 'string') return nbt.string(v);
  if (typeof v === 'boolean') return nbt.byte(v ? 1 : 0);
  if (typeof v === 'number') return nbt.int(v);
  const o = {};
  for (const k of Object.keys(v)) o[k] = toNbt(v[k]);
  return nbt.comp(o);
}

const dialogNbt = () => toNbt(DIALOG);
const dialogJson = () => JSON.parse(JSON.stringify(DIALOG));

const supported = (pv) => pv >= MIN_PV;

// returns a copy of the `tags` array with our dialog added to pause_screen_additions
function addTag(tags, index) {
  const out = (tags || []).map(t => ({ tagType: t.tagType, tags: t.tags.map(x => ({ tagName: x.tagName, entries: x.entries.slice() })) }));
  let type = out.find(t => t.tagType === DIALOG_REG);
  if (!type) { type = { tagType: DIALOG_REG, tags: [] }; out.push(type); }
  const tag = type.tags.find(x => x.tagName === DIALOG_TAG);
  if (!tag) type.tags.push({ tagName: DIALOG_TAG, entries: [index] });
  else if (!tag.entries.includes(index)) tag.entries.push(index);
  return out;
}

// Rebuilds the configuration replay for the first client.
//  log:   [{ name, buf, d? }]  the server's configuration packets (d only for registry_data / tags)
//  build: (name, params) => Buffer|null   configuration-state serializer
// Returns { bufs, index } or throws / returns { error } when the log cannot be patched safely.
function patchConfig(log, build) {
  const entry = { key: KEY, value: dialogNbt() };
  const regs = log.filter(p => p.name === 'registry_data' && p.d && p.d.id === DIALOG_REG);
  if (regs.length > 1) return { error: 'several dialog registries' };
  const hasReg = regs.length === 1;
  const bufs = [];
  let index = -1; let regDone = false; let tagsDone = false;

  const addReg = () => {
    const b = build('registry_data', { id: DIALOG_REG, entries: [entry] });
    if (!b) return false;
    index = 0; regDone = true; bufs.push(b); return true;
  };
  const addTags = (tags) => {
    const b = build('tags', { tags: addTag(tags, index) });
    if (!b) return false;
    tagsDone = true; bufs.push(b); return true;
  };

  for (const p of log) {
    if (p.name === 'registry_data' && p.d && p.d.id === DIALOG_REG) {
      // the unchanged packet must survive a parse/serialize round trip, otherwise leave it alone
      const same = build('registry_data', p.d);
      if (!same || !same.equals(p.buf)) return { error: 'dialog registry does not round-trip' };
      if (p.d.entries.some(e => e.key === KEY)) return { error: 'entry already present' };
      index = p.d.entries.length;
      const b = build('registry_data', { id: DIALOG_REG, entries: p.d.entries.concat([entry]) });
      if (!b) return { error: 'cannot serialize dialog registry' };
      bufs.push(b); regDone = true;
      continue;
    }
    if (p.name === 'tags' && p.d && !tagsDone) {
      if (!regDone) { if (hasReg) return { error: 'tags before dialog registry' }; if (!addReg()) return { error: 'cannot serialize dialog registry' }; }
      const same = build('tags', p.d);
      if (!same || !same.equals(p.buf)) return { error: 'tags do not round-trip' };
      if (!addTags(p.d.tags)) return { error: 'cannot serialize tags' };
      continue;
    }
    if (p.name === 'finish_configuration') {
      if (!regDone && !addReg()) return { error: 'cannot serialize dialog registry' };
      if (!tagsDone && !addTags([])) return { error: 'cannot serialize tags' };
    }
    bufs.push(p.buf);
  }
  if (!regDone || !tagsDone) return { error: 'configuration has no finish packet' };
  return { bufs, index };
}

// chat fallback for versions without dialogs (and an extra way on newer ones)
function isCommand(name, d) {
  if (!d) return false;
  if (name === 'chat_command' || name === 'chat_command_signed') return String(d.command || '').trim().replace(/^\//, '').toLowerCase() === COMMAND;
  if (name === 'chat_message' || name === 'chat') return String(d.message || '').trim().toLowerCase() === '/' + COMMAND;
  return false;
}

module.exports = { MIN_PV, DIALOG_REG, DIALOG_TAG, KEY, ACTION_ID, COMMAND, DIALOG, dialogNbt, dialogJson, supported, addTag, patchConfig, isCommand };
