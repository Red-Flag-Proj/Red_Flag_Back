function decideInitialResponse(riskLevel, riskScore = 0) {
  if (riskScore >= 81) {
    return {
      status: 'CARD_SUSPENDED',
      action: 'AUTO_CARD_SUSPEND',
      label: 'Risk score is 81 or higher. Transaction is blocked and card suspension is requested.'
    };
  }

  if (riskLevel === 'DANGER') {
    return {
      status: 'BLOCKED',
      action: 'AUTO_BLOCK',
      label: 'Risk score is 61 or higher. Transaction is blocked.'
    };
  }

  if (riskScore >= 46) {
    return {
      status: 'CALL_REQUIRED',
      action: 'AUTO_CALL_REQUIRED',
      label: 'Risk score is between 46 and 60. Customer phone verification is required.'
    };
  }

  if (riskScore >= 31) {
    return {
      status: 'REQUIRES_AUTH',
      action: 'AUTO_REQUIRE_AUTH',
      label: 'Risk score is between 31 and 60. Additional authentication is required.'
    };
  }

  return {
    status: 'APPROVED',
    action: 'AUTO_APPROVE',
    label: 'Risk score is between 0 and 30. Transaction is approved.'
  };
}

function mapAdminAction(action) {
  const actionMap = {
    APPROVE: { status: 'APPROVED', action: 'ADMIN_APPROVE' },
    HOLD: { status: 'PENDING_REVIEW', action: 'ADMIN_HOLD' },
    BLOCK: { status: 'BLOCKED', action: 'ADMIN_BLOCK' },
    REQUEST_AUTH: { status: 'REQUIRES_AUTH', action: 'ADMIN_REQUIRE_AUTH' },
    CALL_APPROVE: { status: 'APPROVED', action: 'ADMIN_CALL_APPROVE' },
    CALL_HOLD: { status: 'PENDING_REVIEW', action: 'ADMIN_CALL_HOLD' }
  };

  return actionMap[action];
}

module.exports = { decideInitialResponse, mapAdminAction };
