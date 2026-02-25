import { Request, Response } from "express";
import { DashboardService } from "./dashboard.service";

const dashboardService = new DashboardService();

export class DashboardController {
  /**
   * GET /dashboard/gas-spending?merchantId=&month=
   * Returns monthly gas spending aggregation for a merchant
   */
  async getMonthlySpending(req: Request, res: Response): Promise<void> {
    try {
      const { merchantId, month } = req.query as {
        merchantId: string;
        month: string;
      };

      if (!merchantId || !month) {
        res.status(400).json({
          success: false,
          message: "merchantId and month are required query parameters",
        });
        return;
      }

      const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
      if (!monthRegex.test(month)) {
        res.status(400).json({
          success: false,
          message: "month must be in YYYY-MM format (e.g., 2024-03)",
        });
        return;
      }

      const data = await dashboardService.getMonthlySpending({
        merchantId,
        month,
      });

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * GET /dashboard/gas-spending/:merchantId/detail
   * Returns full detail report including all-time totals, monthly breakdown, and chain breakdown
   */
  async getMerchantDetail(req: Request, res: Response): Promise<void> {
    try {
      const { merchantId } = req.params;

      if (!merchantId) {
        res.status(400).json({
          success: false,
          message: "merchantId is required",
        });
        return;
      }

      const data = await dashboardService.getMerchantDetail(merchantId);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ success: false, message });
    }
  }
}
