import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { BankerDirectory } from './schemas/bank-directory.schema';
import { BankerDirectoryReview } from './schemas/banker_directory_review.schema';
import { CreateBankerDirectoryDto } from './dto/create-bank-directory.dto';
import { UpdateBankerDirectoryDto } from './dto/update-bank-directory.dto';
import { AssociatedOption } from './schemas/associated-option.schema';

@Injectable()
export class BankerDirectoryService {
  private readonly logger = new Logger(BankerDirectoryService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
  @InjectModel(BankerDirectory.name)
  private readonly bankerDirectoryModel: Model<BankerDirectory>,

  @InjectModel(BankerDirectoryReview.name)
  private readonly reviewModel: Model<BankerDirectoryReview>,

  @InjectModel(AssociatedOption.name)
  private readonly associatedModel: Model<AssociatedOption>,

  private readonly configService: ConfigService,
) {
  this.bucketName = this.configService.getOrThrow<string>('AWS_BUCKET_NAME');

this.s3Client = new S3Client({
  region: this.configService.getOrThrow<string>('AWS_REGION'),
  credentials: {
    accessKeyId: this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
    secretAccessKey: this.configService.getOrThrow<string>(
      'AWS_SECRET_ACCESS_KEY',
    ),
  },
});
}

  private readonly allowedImageMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ];

  private async uploadToS3(file: Express.Multer.File, folder: string): Promise<string> {
    if (!file?.mimetype || !this.allowedImageMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file?.mimetype || 'unknown'}. Allowed: jpg, jpeg, png, webp`,
      );
    }

    const key = `${folder}/${randomUUID()}-${file.originalname}`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return key;
  }

  private async deleteFromS3(key?: string | null): Promise<void> {
    if (!key) return;
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
  }

  private async safeDeleteFromS3(key?: string | null): Promise<void> {
    if (!key) return;
    try {
      await this.deleteFromS3(key);
    } catch (err: any) {
      this.logger.warn(`Orphaned S3 object delete failed (${key}): ${err?.message}`);
    }
  }

  private async getSignedUrlForKey(key?: string | null): Promise<string | null> {
    if (!key) return null;
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  private async withSignedImageUrls(doc: any): Promise<any> {
    if (!doc) return doc;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const [profileImage, coverImage] = await Promise.all([
      this.getSignedUrlForKey(obj.profileImage),
      this.getSignedUrlForKey(obj.coverImage),
    ]);
    return { ...obj, profileImage, coverImage };
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }


  private extractUserId(userPayload: any): string {
    const id =
      userPayload?._id || userPayload?.id || userPayload?.userId || userPayload?.sub;

    if (!id) {
      throw new BadRequestException('User not identified from token');
    }
    const idStr = String(id);
    if (!Types.ObjectId.isValid(idStr)) {
      throw new BadRequestException('Invalid user identifier in token');
    }
    return idStr;
  }

  async getAssociatedOptions() {
    return this.associatedModel.find().sort({ name: 1 }).exec();
  }

  async upsertAssociatedOption(name: string) {
    if (!name?.trim()) return null;
    const clean = name.trim();
    const safe = this.escapeRegex(clean);

    return this.associatedModel.findOneAndUpdate(
      { name: { $regex: `^${safe}$`, $options: 'i' } },
      { $setOnInsert: { name: clean } },
      { upsert: true, new: true, runValidators: true },
    );
  }


  async requestReview(dto: CreateBankerDirectoryDto, userPayload?: any) {
    const createdBy = new Types.ObjectId(this.extractUserId(userPayload));

    const { profileImage, coverImage, ...safeDto } = dto as any;

    if (safeDto?.associatedWith) {
      await this.upsertAssociatedOption(safeDto.associatedWith);
    }

    return this.reviewModel.create({
      ...safeDto,
      status: 'pending',
      createdBy,
      createdByName: userPayload?.fullName || null,
      createdByEmail: userPayload?.email || null,
    });
  }

  async getAllReviews(page?: number, limit?: number) {
    const query = this.reviewModel
      .find()
      .populate('createdBy', 'fullName email role')
      .sort({ createdAt: -1 });

    if (page && limit) {
      query.skip((page - 1) * limit).limit(limit);
    }
    return query.exec();
  }

  async approveReview(id: string, adminUser?: any) {
    const updatePayload: any = { status: 'approved' };
    if (adminUser) updatePayload.updatedBy = this.extractUserId(adminUser);

    const review = await this.reviewModel.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: updatePayload },
      { new: false },
    );

    if (!review) {
      const exists = await this.reviewModel.exists({ _id: id });
      if (!exists) throw new NotFoundException('Review not found');
      throw new BadRequestException('This review has already been processed');
    }

    if (review.associatedWith) {
      await this.upsertAssociatedOption(review.associatedWith);
    }

    const obj: any = review.toObject();
    delete obj._id;
    delete obj.__v;
    delete obj.createdAt;
    delete obj.updatedAt;
    delete obj.status;
    delete obj.rejectionReason;
    delete obj.updatedBy;
    delete obj.profileImage; 
    delete obj.coverImage;

    const approved = await this.bankerDirectoryModel.create(obj);
    return this.withSignedImageUrls(approved);
  }

  async rejectReview(id: string, reason: string, adminUser?: any) {
    const updatePayload: any = { status: 'rejected', rejectionReason: reason };
    if (adminUser) updatePayload.updatedBy = this.extractUserId(adminUser);

    const review = await this.reviewModel.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: updatePayload },
      { new: true, runValidators: true },
    );

    if (!review) {
      const exists = await this.reviewModel.exists({ _id: id });
      if (!exists) throw new NotFoundException('Review not found');
      throw new BadRequestException('This review has already been processed');
    }

    return { message: 'Submission rejected successfully', reason };
  }

  async getMyProfile(userPayload: any) {
    const userId = this.extractUserId(userPayload);
    const profile = await this.bankerDirectoryModel.findOne({ createdBy: userId }).exec();

    if (!profile) {
      throw new NotFoundException(
        'Profile not found. Submit a directory request and get approved first.',
      );
    }
    return this.withSignedImageUrls(profile);
  }

  async getProfile(id: string) {
    const profile = await this.bankerDirectoryModel.findById(id).exec();
    if (!profile) throw new NotFoundException('Banker profile not found');
    return this.withSignedImageUrls(profile);
  }

  async updateMyProfile(userPayload: any, dto: UpdateBankerDirectoryDto) {
    const userId = this.extractUserId(userPayload);
    const { profileImage, coverImage, ...safeDto } = dto as any;

    if (safeDto?.associatedWith) {
      await this.upsertAssociatedOption(safeDto.associatedWith);
    }

    const updated = await this.bankerDirectoryModel
      .findOneAndUpdate({ createdBy: userId }, safeDto, {
        new: true,
        runValidators: true,
      })
      .exec();

    if (!updated) {
      throw new NotFoundException(
        'Profile not found. Submit a directory request and get approved first.',
      );
    }
    return this.withSignedImageUrls(updated);
  }

  async adminUpdateProfile(id: string, dto: UpdateBankerDirectoryDto) {
    const { profileImage, coverImage, ...safeDto } = dto as any;

    if (safeDto?.associatedWith) {
      await this.upsertAssociatedOption(safeDto.associatedWith);
    }

    const updated = await this.bankerDirectoryModel
      .findByIdAndUpdate(id, safeDto, { new: true, runValidators: true })
      .exec();

    if (!updated) throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    return this.withSignedImageUrls(updated);
  }

  async uploadProfileImage(userPayload: any, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    const userId = this.extractUserId(userPayload);

    const profile = await this.bankerDirectoryModel.findOne({ createdBy: userId });
    if (!profile) {
      throw new NotFoundException(
        'Profile not found. Submit a directory request and get approved first.',
      );
    }

    const oldKey = profile.profileImage;
    const newKey = await this.uploadToS3(file, 'banker-profile-images');

    try {
      profile.profileImage = newKey;
      await profile.save();
    } catch (err) {
      await this.safeDeleteFromS3(newKey); 
      throw err;
    }

    await this.safeDeleteFromS3(oldKey);
    return { profileImage: await this.getSignedUrlForKey(newKey) };
  }

  async uploadCoverImage(userPayload: any, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    const userId = this.extractUserId(userPayload);

    const profile = await this.bankerDirectoryModel.findOne({ createdBy: userId });
    if (!profile) {
      throw new NotFoundException(
        'Profile not found. Submit a directory request and get approved first.',
      );
    }

    const oldKey = profile.coverImage;
    const newKey = await this.uploadToS3(file, 'banker-cover-images');

    try {
      profile.coverImage = newKey;
      await profile.save();
    } catch (err) {
      await this.safeDeleteFromS3(newKey);
      throw err;
    }

    await this.safeDeleteFromS3(oldKey);
    return { coverImage: await this.getSignedUrlForKey(newKey) };
  }

  async uploadProfileImageById(id: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');

    const existing = await this.bankerDirectoryModel
      .findById(id)
      .select('profileImage')
      .lean();
    if (!existing) {
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }

    const oldKey = existing.profileImage;
    const newKey = await this.uploadToS3(file, 'banker-profile-images');
    const updated = await this.bankerDirectoryModel
      .findByIdAndUpdate(id, { profileImage: newKey }, { new: true })
      .exec();

    if (!updated) {
      await this.safeDeleteFromS3(newKey);
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }

    await this.safeDeleteFromS3(oldKey);
    return this.withSignedImageUrls(updated);
  }

  async uploadCoverImageById(id: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');

    const existing = await this.bankerDirectoryModel
      .findById(id)
      .select('coverImage')
      .lean();
    if (!existing) {
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }

    const oldKey = existing.coverImage;
    const newKey = await this.uploadToS3(file, 'banker-cover-images');

    const updated = await this.bankerDirectoryModel
      .findByIdAndUpdate(id, { coverImage: newKey }, { new: true })
      .exec();

    if (!updated) {
      await this.safeDeleteFromS3(newKey);
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }

    await this.safeDeleteFromS3(oldKey);
    return this.withSignedImageUrls(updated);
  }

  async deleteProfileImage(userPayload: any) {
    const userId = this.extractUserId(userPayload);
    const profile = await this.bankerDirectoryModel.findOne({ createdBy: userId });
    if (!profile) throw new NotFoundException('Profile not found for this user');

    const oldKey = profile.profileImage;
    profile.profileImage = undefined;
    await profile.save();

    await this.safeDeleteFromS3(oldKey);
    return { message: 'Profile image removed' };
  }

  async deleteCoverImage(userPayload: any) {
    const userId = this.extractUserId(userPayload);
    const profile = await this.bankerDirectoryModel.findOne({ createdBy: userId });
    if (!profile) throw new NotFoundException('Profile not found for this user');

    const oldKey = profile.coverImage;
    profile.coverImage = undefined;
    await profile.save();

    await this.safeDeleteFromS3(oldKey);
    return { message: 'Cover image removed' };
  }

  async linkUser(id: string, userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }

    const updated = await this.bankerDirectoryModel
      .findByIdAndUpdate(
        id,
        { createdBy: new Types.ObjectId(userId) },
        { new: true, runValidators: true },
      )
      .exec();

    if (!updated) throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    return this.withSignedImageUrls(updated);
  }


  async create(createDto: CreateBankerDirectoryDto) {
    const { profileImage, coverImage, ...safeDto } = createDto as any;

    if (safeDto?.associatedWith) {
      await this.upsertAssociatedOption(safeDto.associatedWith);
    }

    const created = new this.bankerDirectoryModel(safeDto);
    const saved = await created.save();
    return this.withSignedImageUrls(saved);
  }

  async findAll() {
    const docs = await this.bankerDirectoryModel.find().exec();
    return Promise.all(docs.map((doc) => this.withSignedImageUrls(doc)));
  }

  async findOne(id: string) {
    const bankerDirectory = await this.bankerDirectoryModel.findById(id).exec();
    if (!bankerDirectory) {
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }
    return this.withSignedImageUrls(bankerDirectory);
  }

  async update(id: string, updateDto: UpdateBankerDirectoryDto) {
    const { profileImage, coverImage, ...safeDto } = updateDto as any;

    if (safeDto?.associatedWith) {
      await this.upsertAssociatedOption(safeDto.associatedWith);
    }

    const updated = await this.bankerDirectoryModel
      .findByIdAndUpdate(id, safeDto, { new: true, runValidators: true })
      .exec();

    if (!updated) throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    return this.withSignedImageUrls(updated);
  }

  async remove(id: string) {
    const deleted = await this.bankerDirectoryModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException(`Banker Directory with ID ${id} not found`);

    await Promise.all([
      this.safeDeleteFromS3(deleted.profileImage),
      this.safeDeleteFromS3(deleted.coverImage),
    ]);

    return deleted;
  }


  async filterByLocationAndName(
    state?: string,
    city?: string,
    bankerName?: string,
    associatedWith?: string,
    emailOfficial?: string,
    emailPersonal?: string,
    product?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; totalCount: number }> {
    const query: any = {};

    if (state) query.state = { $regex: this.escapeRegex(state), $options: 'i' };
    if (city) query.city = { $regex: this.escapeRegex(city), $options: 'i' };
    if (bankerName) query.bankerName = new RegExp(this.escapeRegex(bankerName), 'i');
    if (associatedWith)
      query.associatedWith = new RegExp(this.escapeRegex(associatedWith), 'i');
    if (emailOfficial)
      query.emailOfficial = new RegExp(this.escapeRegex(emailOfficial), 'i');
    if (emailPersonal)
      query.emailPersonal = new RegExp(this.escapeRegex(emailPersonal), 'i');
    if (product) {
      query.product = { $in: [new RegExp(`^${this.escapeRegex(product)}$`, 'i')] };
    }

    const skip = (page - 1) * limit;
    const [rawData, totalCount] = await Promise.all([
      this.bankerDirectoryModel.find(query).skip(skip).limit(limit).exec(),
      this.bankerDirectoryModel.countDocuments(query),
    ]);

    const data = await Promise.all(rawData.map((doc) => this.withSignedImageUrls(doc)));
    return { data, totalCount };
  }

  async getStateCityMeta() {
    const rows = await this.bankerDirectoryModel
      .aggregate([
        { $match: { state: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$state', cities: { $addToSet: '$city' } } },
      ])
      .exec();

    const states: string[] = [];
    const stateCityMap: Record<string, string[]> = {};

    for (const row of rows) {
      const state = String(row._id || '').trim();
      if (!state) continue;

      const cities = (row.cities || [])
        .filter(Boolean)
        .map((c: any) => String(c).trim())
        .filter((c: string) => c.length > 0)
        .sort((a: string, b: string) => a.localeCompare(b));

      states.push(state);
      stateCityMap[state] = cities;
    }

    states.sort((a, b) => a.localeCompare(b));
    return { states, stateCityMap };
  }

  async getReviewCounts() {
    const [pending, approved, rejected] = await Promise.all([
      this.reviewModel.countDocuments({ status: 'pending' }),
      this.reviewModel.countDocuments({ status: 'approved' }),
      this.reviewModel.countDocuments({ status: 'rejected' }),
    ]);
    return { pending, approved, rejected };
  }

  async bulkImportFromBuffer(buf: Buffer, filename: string) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buf, { type: 'buffer' });
    } catch {
      throw new BadRequestException('Invalid file format');
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new BadRequestException('No worksheet found');

    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) {
      return { success: true, inserted: 0, updated: 0, skipped: 0, errors: [] };
    }

    const errors: { row: number; message: string }[] = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const toList = (v: any) =>
      String(v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const bankerName = String(r.bankerName || r.BankerName || '').trim();
      const associatedWith = String(r.associatedWith || r.AssociatedWith || '').trim();
      const emailOfficial = String(r.emailOfficial || r.EmailOfficial || '').trim();
      const emailPersonal = String(r.emailPersonal || r.EmailPersonal || '').trim();
      const contact = String(r.contact || r.Contact || '').trim();
      const alternateNumber = String(r.alternateNumber || r.AlternateNumber || '').trim();
      const state = String(r.state || r.State || '').trim();
      const city = String(r.city || r.City || '').trim();
      const product = toList(r.product || r.Product);

      if (!bankerName || !associatedWith) {
        skipped++;
        errors.push({ row: i + 2, message: 'bankerName and associatedWith are required' });
        continue;
      }

      await this.upsertAssociatedOption(associatedWith);

      const filter: any = emailOfficial
        ? { emailOfficial }
        : { bankerName, associatedWith, contact };

      const payload = {
        bankerName,
        associatedWith,
        emailOfficial,
        emailPersonal,
        contact,
        alternateNumber,
        state,
        city,
        product,
      };

      try {
        const res: any = await this.bankerDirectoryModel.updateOne(
          filter,
          { $set: payload },
          { upsert: true },
        );

        if (res.upsertedCount > 0) inserted++;
        else if (res.modifiedCount > 0) updated++;
        else skipped++;
      } catch (e: any) {
        errors.push({ row: i + 2, message: e?.message || 'Unknown DB error' });
      }
    }

    return { success: true, inserted, updated, skipped, errors };
  }


  async getMyReviews(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user identifier');
    }
    return this.reviewModel
      .find({ createdBy: userId })
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getMyApprovedBankers(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user identifier');
    }
    const docs = await this.bankerDirectoryModel
      .find({ createdBy: userId })
      .sort({ createdAt: -1 })
      .exec();

    return Promise.all(docs.map((doc) => this.withSignedImageUrls(doc)));
  }


  async getUserCollectionsSummary(params?: {
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'coins' | 'approved' | 'recent';
  }) {
    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(5, Number(params?.limit || 10)));
    const skip = (page - 1) * limit;

    const search = String(params?.search || '').trim();
    const sort = (params?.sort || 'coins') as 'coins' | 'approved' | 'recent';

    // ✅ rule
    const COINS_PER_APPROVED = 1;
    const COINS_TO_RUPEE_DIVISOR = 100;

    const match: any = {};

    if (search) {
      match.$or = [
        { createdByName: { $regex: search, $options: 'i' } },
        { createdByEmail: { $regex: search, $options: 'i' } },
        { createdBy: { $regex: search, $options: 'i' } },
      ];
    }

    const sortStage =
      sort === 'recent'
        ? { lastActivityAt: -1 }
        : sort === 'approved'
        ? { approvedLeads: -1 }
        : { coins: -1 };

    const pipeline: any[] = [
      { $match: match },

      {
        $group: {
          _id: '$createdBy',
          name: { $first: '$createdByName' },
          email: { $first: '$createdByEmail' },

          totalLeads: { $sum: 1 },
          approvedLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] },
          },
          pendingLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          rejectedLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] },
          },

          lastActivityAt: { $max: '$updatedAt' },
        },
      },

      {
        $addFields: {
          userId: { $toString: '$_id' },
          coins: { $multiply: ['$approvedLeads', COINS_PER_APPROVED] },
          rupees: {
            $divide: [
              { $multiply: ['$approvedLeads', COINS_PER_APPROVED] },
              COINS_TO_RUPEE_DIVISOR,
            ],
          },
        },
      },

      { $sort: sortStage },

      // facet: data + totals + total count
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: 'totalUsers' }],
          totals: [
            {
              $group: {
                _id: null,
                totalCoins: { $sum: '$coins' },
                totalRupees: { $sum: '$rupees' },
              },
            },
          ],
        },
      },
    ];

    const agg = await this.reviewModel.aggregate(pipeline).exec();
    const first = agg?.[0] || {};

    const data = first.data || [];
    const totalUsers = first.meta?.[0]?.totalUsers || 0;
    const totalCoins = first.totals?.[0]?.totalCoins || 0;
    const totalRupees = first.totals?.[0]?.totalRupees || 0;

    return {
      page,
      limit,
      totalUsers,
      totalCoins,
      totalRupees,
      rule: { approvedToCoin: 1, coinToRupee: 100 },
      data,
    };
  }
}