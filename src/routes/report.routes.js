const express = require('express');
const { authRequired, adminRequired } = require('../middlewares/auth.middleware');
const { listReportRows } = require('../services/admin.service');
const { buildCsv, buildPdf } = require('../services/report.service');

const router = express.Router();

router.use(authRequired, adminRequired);

router.get('/fraud.csv', async (req, res, next) => {
  try {
    const rows = await listReportRows();
    const csv = buildCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fraud-report.csv"');
    res.send(`\uFEFF${csv}`);
  } catch (err) {
    next(err);
  }
});

router.get('/fraud.pdf', async (req, res, next) => {
  try {
    const rows = await listReportRows();
    const pdf = await buildPdf(rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="fraud-report.pdf"; filename*=UTF-8\'\'fraud-report.pdf');
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

module.exports = { reportRoutes: router };
