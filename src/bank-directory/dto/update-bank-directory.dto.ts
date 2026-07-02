import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

// multipart/form-data me arrays/nested objects JSON string bankar aate hain —
// validation chalne se pehle unhe wapas real object/array me convert karo
function parseJson(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

// multipart/form-data me boolean bhi string bankar aata hai —
// Boolean('false') JS me true hota hai, isliye explicit check zaroori hai
function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return value;
}

class ExperienceDto {
  @IsOptional()
  @IsString()
  institutionName?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  currentlyWorking?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

class EducationDto {
  @IsOptional()
  @IsString()
  institute?: string;

  @IsOptional()
  @IsString()
  degree?: string;

  @IsOptional()
  @IsString()
  fieldOfStudy?: string;

  @IsOptional()
  @IsString()
  startYear?: string;

  @IsOptional()
  @IsString()
  endYear?: string;
}

class SocialLinksDto {
  @IsOptional()
  @IsString()
  linkedin?: string;

  @IsOptional()
  @IsString()
  facebook?: string;

  @IsOptional()
  @IsString()
  instagram?: string;

  @IsOptional()
  @IsString()
  twitter?: string;

  @IsOptional()
  @IsString()
  website?: string;
}

export class UpdateBankerDirectoryDto {
  // ==========================
  // Basic Details
  // ==========================

  @IsOptional()
  @IsString()
  bankerName?: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  about?: string;

  @IsOptional()
  @IsString()
  associatedWith?: string;

  @IsOptional()
  @IsString()
  lastCurrentDesignation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalExperience?: number;

  // ==========================
  // Images (S3 keys) — service upload ke baad ye set karti hai
  // ==========================

  @IsOptional()
  @IsString()
  profileImage?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  // ==========================
  // Contact
  // ==========================

  @IsOptional()
  @IsEmail()
  emailOfficial?: string;

  @IsOptional()
  @IsEmail()
  emailPersonal?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  alternateNumber?: string;

  // ==========================
  // Location
  // ==========================

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // ==========================
  // Products
  // ==========================

  @IsOptional()
  @Transform(({ value }) => parseJson(value))
  @IsArray()
  @IsString({ each: true })
  product?: string[];

  // ==========================
  // Skills
  // ==========================

  @IsOptional()
  @Transform(({ value }) => parseJson(value))
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  // ==========================
  // Experience
  // ==========================

  @IsOptional()
  @Transform(({ value }) => parseJson(value))
  @ValidateNested({ each: true })
  @Type(() => ExperienceDto)
  experience?: ExperienceDto[];

  // ==========================
  // Education
  // ==========================

  @IsOptional()
  @Transform(({ value }) => parseJson(value))
  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  education?: EducationDto[];

  // ==========================
  // Social Links
  // ==========================

  @IsOptional()
  @Transform(({ value }) => parseJson(value))
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  // ==========================
  // Profile Status
  // ==========================

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  profileCompletion?: number;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  isProfileCompleted?: boolean;
}