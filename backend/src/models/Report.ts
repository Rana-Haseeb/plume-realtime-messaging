import mongoose, { Schema, Document, Types } from "mongoose";

export interface IReport extends Document {
  reporter: Types.ObjectId;
  reportedUser: Types.ObjectId;
  reason: string;
}

const reportSchema = new Schema<IReport>(
  {
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

export default mongoose.model<IReport>("Report", reportSchema);
