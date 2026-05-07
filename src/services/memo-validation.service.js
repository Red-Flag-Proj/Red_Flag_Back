const { HttpError } = require('../utils/http-error');

const NEGATIVE_APPROVAL_PATTERNS = [
  /승인\s*(안|않|불가|거부|거절|취소|보류|차단)/i,
  /(승인하지\s*않|승인하면\s*안|승인\s*금지)/i,
  /(거절|거부|차단|보류|정지|불허|반려|위험|사기|fraud|block|reject|deny|hold)/i,
  /(do\s*not\s*approve|don't\s*approve|not\s*approve)/i
];

function validateAdminActionMemo(action, memo = '') {
  if (action !== 'APPROVE' && action !== 'CALL_APPROVE') return;

  const normalizedMemo = memo.trim();
  if (!normalizedMemo) return;

  const hasNegativeApprovalIntent = NEGATIVE_APPROVAL_PATTERNS.some((pattern) => pattern.test(normalizedMemo));
  if (hasNegativeApprovalIntent) {
    throw new HttpError(400, '승인 조치 메모에 승인 반대 또는 차단/보류 의도가 포함되어 있어 승인할 수 없습니다.');
  }
}

module.exports = { validateAdminActionMemo };
