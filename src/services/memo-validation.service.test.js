const assert = require('assert');
const { validateAdminActionMemo } = require('./memo-validation.service');

assert.throws(
  () => validateAdminActionMemo('APPROVE', '승인안합니다. 위험해서 차단 필요'),
  /승인 조치 메모/
);

assert.throws(
  () => validateAdminActionMemo('APPROVE', 'do not approve this transaction'),
  /승인 조치 메모/
);

assert.doesNotThrow(() => validateAdminActionMemo('APPROVE', '본인 확인 완료 후 승인합니다.'));
assert.doesNotThrow(() => validateAdminActionMemo('BLOCK', '위험해서 차단합니다.'));

console.log('Memo validation test passed.');
