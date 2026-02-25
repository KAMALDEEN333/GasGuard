import { GasTransaction } from "./dashboard.model";

export interface MonthlySpendingQuery {
  merchantId: string;
  month: string; // format: YYYY-MM
}

export interface ChainBreakdown {
  chain: string;
  totalTransactions: number;
  totalGasUsed: number;
  averageGasPerTransaction: number;
  totalGasCostEth: number;
  totalGasCostUsd: number;
  transactionTypeBreakdown: {
    type: string;
    count: number;
    totalGasCostEth: number;
    totalGasCostUsd: number;
  }[];
}

export interface MonthlySpendingSummary {
  merchantId: string;
  month: string;
  totalTransactions: number;
  totalGasCostEth: number;
  totalGasCostUsd: number;
  chains: ChainBreakdown[];
}

export interface DetailReport {
  merchantId: string;
  wallets: string[];
  chains: string[];
  allTimeTotal: {
    totalTransactions: number;
    totalGasCostEth: number;
    totalGasCostUsd: number;
  };
  monthlyBreakdown: {
    month: string;
    totalTransactions: number;
    totalGasCostEth: number;
    totalGasCostUsd: number;
  }[];
  chainBreakdown: ChainBreakdown[];
}

export class DashboardService {
  async getMonthlySpending(
    query: MonthlySpendingQuery
  ): Promise<MonthlySpendingSummary> {
    const { merchantId, month } = query;

    const [year, monthNum] = month.split("-").map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 1);

    const chainAggregation = await GasTransaction.aggregate([
      {
        $match: {
          merchantId,
          timestamp: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: {
            chain: "$chain",
            transactionType: "$transactionType",
          },
          count: { $sum: 1 },
          totalGasUsed: { $sum: "$gasUsed" },
          totalGasCostEth: { $sum: { $toDouble: "$totalGasCostEth" } },
          totalGasCostUsd: { $sum: "$totalGasCostUsd" },
        },
      },
      {
        $group: {
          _id: "$_id.chain",
          totalTransactions: { $sum: "$count" },
          totalGasUsed: { $sum: "$totalGasUsed" },
          totalGasCostEth: { $sum: "$totalGasCostEth" },
          totalGasCostUsd: { $sum: "$totalGasCostUsd" },
          transactionTypeBreakdown: {
            $push: {
              type: "$_id.transactionType",
              count: "$count",
              totalGasCostEth: "$totalGasCostEth",
              totalGasCostUsd: "$totalGasCostUsd",
            },
          },
        },
      },
    ]);

    const chains: ChainBreakdown[] = chainAggregation.map((c) => ({
      chain: c._id,
      totalTransactions: c.totalTransactions,
      totalGasUsed: c.totalGasUsed,
      averageGasPerTransaction:
        c.totalTransactions > 0
          ? Math.round(c.totalGasUsed / c.totalTransactions)
          : 0,
      totalGasCostEth: parseFloat(c.totalGasCostEth.toFixed(8)),
      totalGasCostUsd: parseFloat(c.totalGasCostUsd.toFixed(2)),
      transactionTypeBreakdown: c.transactionTypeBreakdown,
    }));

    const totals = chains.reduce(
      (acc, chain) => {
        acc.totalTransactions += chain.totalTransactions;
        acc.totalGasCostEth += chain.totalGasCostEth;
        acc.totalGasCostUsd += chain.totalGasCostUsd;
        return acc;
      },
      { totalTransactions: 0, totalGasCostEth: 0, totalGasCostUsd: 0 }
    );

    return {
      merchantId,
      month,
      totalTransactions: totals.totalTransactions,
      totalGasCostEth: parseFloat(totals.totalGasCostEth.toFixed(8)),
      totalGasCostUsd: parseFloat(totals.totalGasCostUsd.toFixed(2)),
      chains,
    };
  }

  async getMerchantDetail(merchantId: string): Promise<DetailReport> {
    const walletAgg = await GasTransaction.aggregate([
      { $match: { merchantId } },
      {
        $group: {
          _id: null,
          wallets: { $addToSet: "$walletAddress" },
          chains: { $addToSet: "$chain" },
          totalTransactions: { $sum: 1 },
          totalGasCostEth: { $sum: { $toDouble: "$totalGasCostEth" } },
          totalGasCostUsd: { $sum: "$totalGasCostUsd" },
        },
      },
    ]);

    const monthlyAgg = await GasTransaction.aggregate([
      { $match: { merchantId } },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
          },
          totalTransactions: { $sum: 1 },
          totalGasCostEth: { $sum: { $toDouble: "$totalGasCostEth" } },
          totalGasCostUsd: { $sum: "$totalGasCostUsd" },
        },
      },
      { $sort: { "_id.year": -1, "_id.month": -1 } },
    ]);

    const chainAgg = await GasTransaction.aggregate([
      { $match: { merchantId } },
      {
        $group: {
          _id: {
            chain: "$chain",
            transactionType: "$transactionType",
          },
          count: { $sum: 1 },
          totalGasUsed: { $sum: "$gasUsed" },
          totalGasCostEth: { $sum: { $toDouble: "$totalGasCostEth" } },
          totalGasCostUsd: { $sum: "$totalGasCostUsd" },
        },
      },
      {
        $group: {
          _id: "$_id.chain",
          totalTransactions: { $sum: "$count" },
          totalGasUsed: { $sum: "$totalGasUsed" },
          totalGasCostEth: { $sum: "$totalGasCostEth" },
          totalGasCostUsd: { $sum: "$totalGasCostUsd" },
          transactionTypeBreakdown: {
            $push: {
              type: "$_id.transactionType",
              count: "$count",
              totalGasCostEth: "$totalGasCostEth",
              totalGasCostUsd: "$totalGasCostUsd",
            },
          },
        },
      },
    ]);

    const base = walletAgg[0] ?? {
      wallets: [],
      chains: [],
      totalTransactions: 0,
      totalGasCostEth: 0,
      totalGasCostUsd: 0,
    };

    const monthlyBreakdown = monthlyAgg.map((m) => ({
      month: `${m._id.year}-${String(m._id.month).padStart(2, "0")}`,
      totalTransactions: m.totalTransactions,
      totalGasCostEth: parseFloat(m.totalGasCostEth.toFixed(8)),
      totalGasCostUsd: parseFloat(m.totalGasCostUsd.toFixed(2)),
    }));

    const chainBreakdown: ChainBreakdown[] = chainAgg.map((c) => ({
      chain: c._id,
      totalTransactions: c.totalTransactions,
      totalGasUsed: c.totalGasUsed,
      averageGasPerTransaction:
        c.totalTransactions > 0
          ? Math.round(c.totalGasUsed / c.totalTransactions)
          : 0,
      totalGasCostEth: parseFloat(c.totalGasCostEth.toFixed(8)),
      totalGasCostUsd: parseFloat(c.totalGasCostUsd.toFixed(2)),
      transactionTypeBreakdown: c.transactionTypeBreakdown,
    }));

    return {
      merchantId,
      wallets: base.wallets,
      chains: base.chains,
      allTimeTotal: {
        totalTransactions: base.totalTransactions,
        totalGasCostEth: parseFloat(base.totalGasCostEth.toFixed(8)),
        totalGasCostUsd: parseFloat(base.totalGasCostUsd.toFixed(2)),
      },
      monthlyBreakdown,
      chainBreakdown,
    };
  }
}
