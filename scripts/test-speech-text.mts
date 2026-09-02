import assert from 'node:assert/strict';

import { prepareTextForSpeech, speechLanguageFor } from '../src/speech/speechText.ts';

assert.equal(
  prepareTextForSpeech('อ. 1 ก.ย. 13:00 น.'),
  'วันอังคาร 1 กันยายน เวลา 13 นาฬิกา',
);
assert.equal(
  prepareTextForSpeech('Tue, Sep 1 · 13:30'),
  'Tuesday, September 1, 1 30 PM',
);
assert.equal(speechLanguageFor('วันอังคาร 1 กันยายน'), 'th-TH');
assert.equal(speechLanguageFor('Tuesday, September 1'), 'en-US');

console.log('✓ speech dates and times are expanded for natural pronunciation');
