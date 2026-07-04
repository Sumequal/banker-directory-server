import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type BankerDirectoryReviewDocument = BankerDirectoryReview & Document;

@Schema()
class Experience {
  @Prop({ trim: true })
  institutionName?: string;

  @Prop({ trim: true })
  designation?: string;

  @Prop()
  startDate?: string;

  @Prop()
  endDate?: string;

  @Prop({ default: false })
  currentlyWorking?: boolean;

  @Prop({ trim: true })
  description?: string;
}
const ExperienceSchema = SchemaFactory.createForClass(Experience);

@Schema()
class Education {
  @Prop({ trim: true })
  institute?: string;

  @Prop({ trim: true })
  degree?: string;

  @Prop({ trim: true })
  fieldOfStudy?: string;

  @Prop()
  startYear?: string;

  @Prop()
  endYear?: string;
}
const EducationSchema = SchemaFactory.createForClass(Education);

// _id: false — single embedded object hai, array nahi, alag _id ki zarurat nahi
@Schema({ _id: false })
class SocialLinks {
  @Prop({ trim: true })
  linkedin?: string;

  @Prop({ trim: true })
  facebook?: string;

  @Prop({ trim: true })
  instagram?: string;

  @Prop({ trim: true })
  twitter?: string;

  @Prop({ trim: true })
  website?: string;
}
const SocialLinksSchema = SchemaFactory.createForClass(SocialLinks);

@Schema({ timestamps: true })
export class BankerDirectoryReview {
  // ==========================
  // User Mapping
  // ==========================

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  userId?: Types.ObjectId;

  // ==========================
  // Basic Information
  // ==========================

  @Prop({ trim: true })
  bankerName?: string;

  @Prop({ trim: true })
  headline?: string;

  @Prop({ trim: true })
  about?: string;

  @Prop({ trim: true })
  associatedWith?: string;

  @Prop({ trim: true })
  lastCurrentDesignation?: string;

  @Prop({ min: 0 })
  totalExperience?: number;

  // ==========================
  // Images (S3 key — signed URL service generate karke deti hai)
  // ==========================

  @Prop()
  profileImage?: string;

  @Prop()
  coverImage?: string;

  // ==========================
  // Contact
  // ==========================

  @Prop({ trim: true, lowercase: true })
  emailOfficial?: string;

  @Prop({ trim: true, lowercase: true })
  emailPersonal?: string;

  @Prop({ trim: true })
  contact?: string;

  @Prop({ trim: true })
  alternateNumber?: string;

  // ==========================
  // Location
  // ==========================

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  city?: string;

  // ==========================
  // Products & Skills
  // ==========================

  @Prop({ type: [String], default: [] })
  product?: string[];

  @Prop({ type: [String], default: [] })
  skills?: string[];

  // ==========================
  // Experience
  // ==========================

  @Prop({ type: [ExperienceSchema], default: [] })
  experience?: Experience[];

  // ==========================
  // Education
  // ==========================

  @Prop({ type: [EducationSchema], default: [] })
  education?: Education[];

  // ==========================
  // Social Links
  // ==========================

  @Prop({ type: SocialLinksSchema, default: {} })
  socialLinks?: SocialLinks;

  // ==========================
  // Profile Completion
  // ==========================

  @Prop({ default: 0, min: 0, max: 100 })
  profileCompletion?: number;

  @Prop({ default: false })
  isProfileCompleted?: boolean;

  // ==========================
  // Review Status
  // ==========================

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  })
  status?: 'pending' | 'approved' | 'rejected';

  @Prop({
  type: String,
  default: null,
})
rejectionReason?: string;


  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  createdBy: Types.ObjectId;

  @Prop({
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  default: null,
})
updatedBy?: Types.ObjectId;

  @Prop({ trim: true })
  createdByName?: string;

  @Prop({ trim: true, lowercase: true })
  createdByEmail?: string;
}

export const BankerDirectoryReviewSchema =
  SchemaFactory.createForClass(BankerDirectoryReview);

// Indexes
BankerDirectoryReviewSchema.index({ userId: 1 });
BankerDirectoryReviewSchema.index({ status: 1 });
BankerDirectoryReviewSchema.index({ createdBy: 1 });
BankerDirectoryReviewSchema.index({ createdAt: -1 });