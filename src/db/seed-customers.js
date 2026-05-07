const { pool } = require('./pool');

const customers = [
  { customerRef: 'CUST-001', name: 'Domestic Small Spender', phone: '010-1000-0001', country: 'KR', region: 'Seoul', segment: 'RETAIL', baseAmount: 38000, countryCode: 'KR', city: 'Seoul', device: 'ios-cust-001', method: 'CARD', category: 'CAFE' },
  { customerRef: 'CUST-002', name: 'Frequent Business Traveler', phone: '010-1000-0002', country: 'KR', region: 'Seoul / US', segment: 'BUSINESS', baseAmount: 160000, countryCode: 'US', city: 'New York', device: 'ios-cust-002', method: 'CARD', category: 'HOTEL' },
  { customerRef: 'CUST-003', name: 'Daytime Salary User', phone: '010-1000-0003', country: 'KR', region: 'Busan', segment: 'RETAIL', baseAmount: 52000, countryCode: 'KR', city: 'Busan', device: 'android-cust-003', method: 'CARD', category: 'GROCERY' },
  { customerRef: 'CUST-004', name: 'High Value Transfer Customer', phone: '010-1000-0004', country: 'KR', region: 'Seoul', segment: 'VIP', baseAmount: 850000, countryCode: 'KR', city: 'Seoul', device: 'desktop-cust-004', method: 'ACCOUNT', category: 'TRANSFER' },
  { customerRef: 'CUST-005', name: 'Online Payment Heavy User', phone: '010-1000-0005', country: 'KR', region: 'Incheon', segment: 'RETAIL', baseAmount: 95000, countryCode: 'KR', city: 'Incheon', device: 'android-cust-005', method: 'E-PAY', category: 'ONLINE' }
];

function amountFor(profile, index) {
  const weekly = 1 + ((index % 7) - 3) * 0.04;
  const seasonal = 1 + ((index % 30) - 15) * 0.006;
  return Math.max(5000, Math.round(profile.baseAmount * weekly * seasonal));
}

function occurredAtFor(index, profile) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - index);
  const hour = profile.customerRef === 'CUST-003' ? 13 : 9 + (index % 11);
  date.setUTCHours(hour, (index * 7) % 60, 0, 0);
  return date.toISOString();
}

async function seed() {
  await pool.query('BEGIN');
  try {
    for (const profile of customers) {
      await pool.query(
        `INSERT INTO customers (customer_ref, name, phone_number, home_country, usual_region, segment)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (customer_ref) DO UPDATE SET
           name = EXCLUDED.name,
           phone_number = EXCLUDED.phone_number,
           home_country = EXCLUDED.home_country,
           usual_region = EXCLUDED.usual_region,
           segment = EXCLUDED.segment`,
        [profile.customerRef, profile.name, profile.phone, profile.country, profile.region, profile.segment]
      );

      await pool.query(
        `INSERT INTO customer_cards (customer_ref, card_token, status)
         VALUES ($1, $2, 'ACTIVE')
         ON CONFLICT (card_token) DO NOTHING`,
        [profile.customerRef, `CARD-${profile.customerRef}`]
      );

      const existing = await pool.query('SELECT COUNT(*)::int AS count FROM transactions WHERE customer_ref = $1', [profile.customerRef]);
      if (existing.rows[0].count >= 900) continue;

      for (let i = 1; i <= 1095; i += 1) {
        const type = profile.method === 'ACCOUNT' ? 'TRANSFER' : 'PAYMENT';
        await pool.query(
          `INSERT INTO transactions
           (customer_ref, customer_name, type, amount, occurred_at, country_code, city, ip_address, device_id, payment_method, merchant_category, recipient_account, status, decided_action)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10, $11, $12, 'APPROVED', 'AUTO_APPROVE')`,
          [
            profile.customerRef,
            profile.name,
            type,
            amountFor(profile, i),
            occurredAtFor(i, profile),
            profile.countryCode,
            profile.city,
            `203.0.113.${(i % 200) + 1}`,
            profile.device,
            profile.method,
            profile.category,
            `BASELINE-${profile.customerRef}`
          ]
        );
      }
    }

    await pool.query('COMMIT');
    console.log('Customer baseline seed completed.');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
