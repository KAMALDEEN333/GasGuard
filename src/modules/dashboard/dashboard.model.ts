import mongoose, { Document, Schema } from "mongoose";

export interface IGasTransaction extends Document {
  merchantId: string;
  walletAddress: string;
  chain: string;
  transactionHash: string;
  transactionType: "transfer" | "swap" | "contract_call" | "other";
  baseFee: string;
  priorityFee: string;
  gasUsed: number;
  gasPrice: string;
  totalGasCostEth: string;
  totalGasCostUsd: number;
  timestamp: Date;
  blockNumber: number;
}

const GasTransactionSchema = new Schema<IGasTransaction>(
  {
    merchantId: { type: String, required: true, index: true },
    walletAddress: { type: String, required: true, index: true },
    chain: { type: String, required: true, index: true },
    transactionHash: { type: String, required: true, unique: true },
    transactionType: {
      type: String,
      enum: ["transfer", "swap", "contract_call", "other"],
      default: "other",
    },
    baseFee: { type: String, required: true },
    priorityFee: { type: String, default: "0" },
    gasUsed: { type: Number, required: true },
    gasPrice: { type: String, required: true },
    totalGasCostEth: { type: String, required: true },
    totalGasCostUsd: { type: Number, required: true },
    timestamp: { type: Date, required: true, index: true },
    blockNumber: { type: Number, required: true },
  },
  { timestamps: true }
);

GasTransactionSchema.index({ merchantId: 1, timestamp: -1 });
GasTransactionSchema.index({ merchantId: 1, chain: 1, timestamp: -1 });

export const GasTransaction = mongoose.model<IGasTransaction>(
  "GasTransaction",
  GasTransactionSchema
);
