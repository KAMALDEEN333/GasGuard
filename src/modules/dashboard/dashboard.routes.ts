import { Router } from "express";
import { DashboardController } from "./dashboard.controller";

const router = Router();
const dashboardController = new DashboardController();

/**
 * @route   GET /dashboard/gas-spending
 * @desc    Get monthly gas spending aggregation for a merchant
 * @access  Private
 * @query   merchantId - Merchant identifier
 * @query   month      - Target month in YYYY-MM format
 */
router.get(
  "/gas-spending",
  dashboardController.getMonthlySpending.bind(dashboardController)
);

/**
 * @route   GET /dashboard/gas-spending/:merchantId/detail
 * @desc    Get full gas spending detail report for a merchant (all-time, monthly, per-chain)
 * @access  Private
 * @param   merchantId - Merchant identifier
 */
router.get(
  "/gas-spending/:merchantId/detail",
  dashboardController.getMerchantDetail.bind(dashboardController)
);

export default router;
