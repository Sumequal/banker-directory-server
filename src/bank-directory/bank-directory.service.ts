import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';

import { BankerDirectory } from './schemas/bank-directory.schema';
import { BankerDirectoryReview } from './schemas/banker_directory_review.schema';
import { CreateBankerDirectoryDto } from './dto/create-bank-directory.dto';
import { UpdateBankerDirectoryDto } from './dto/update-bank-directory.dto';
import { AssociatedOption } from './schemas/associated-option.schema';

@Injectable()
export class BankerDirectoryService {
  constructor(
    @InjectModel(BankerDirectory.name)
    private readonly bankerDirectoryModel: Model<BankerDirectory>,

    @InjectModel(BankerDirectoryReview.name)
    private readonly reviewModel: Model<BankerDirectoryReview>,

    // ✅ NEW
    @InjectModel(AssociatedOption.name)
    private readonly associatedModel: Model<AssociatedOption>,
  ) {}

  // ✅ NEW: (1) Get options list for dropdown
  async getAssociatedOptions() {
    return this.associatedModel.find().sort({ name: 1 }).exec();
  }

  // ✅ NEW: (2) Upsert option (case-insensitive)
  async upsertAssociatedOption(name: string) {
    if (!name?.trim()) return null;
    const clean = name.trim();

    return this.associatedModel.findOneAndUpdate(
      { name: { $regex: `^${clean}$`, $options: 'i' } },
      { $setOnInsert: { name: clean } },
      { upsert: true, new: true },
    );
  }

  // ✅ Request Review (User)
  async requestReview(dto: CreateBankerDirectoryDto, userPayload?: any) {
    const createdByRaw =
      userPayload?._id || userPayload?.id || userPayload?.userId || userPayload?.sub;

    if (!createdByRaw) {
      throw new BadRequestException('User not identified from token');
    }

    const createdBy = new Types.ObjectId(String(createdByRaw));

    // ✅ AUTO SAVE associatedWith (user typed)
    if (dto?.associatedWith) {
      await this.upsertAssociatedOption(dto.associatedWith);
    }

    return this.reviewModel.create({
      ...dto,
      status: 'pending',
      createdBy,
      createdByName: userPayload?.fullName || null,
      createdByEmail: userPayload?.email || null,
    });
  }

  async getAllReviews() {
    return this.reviewModel
      .find()
      .populate('createdBy', 'fullName email role')
      .sort({ createdAt: -1 })
      .exec();
  }

  // ✅ Approve Review → move to main table
  async approveReview(id: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');

    // ✅ AUTO SAVE associatedWith on approve too
    if ((review as any).associatedWith) {
      await this.upsertAssociatedOption((review as any).associatedWith);
    }

    const obj: any = review.toObject();
    delete obj._id;
    delete obj.__v;
    delete obj.createdAt;
    delete obj.updatedAt;

    const approved = await this.bankerDirectoryModel.create(obj);
    await this.reviewModel.findByIdAndUpdate(id, { status: 'approved' });

    return approved;
  }

  async rejectReview(id: string, reason: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');

    review.status = 'rejected';
    (review as any).rejectionReason = reason;
    await review.save();

    return { message: 'Submission rejected successfully', reason };
  }

  async create(createDto: CreateBankerDirectoryDto): Promise<BankerDirectory> {
    if (createDto?.associatedWith) {
      await this.upsertAssociatedOption(createDto.associatedWith);
    }

    const created = new this.bankerDirectoryModel(createDto);
    return await created.save();
  }

  async findAll(): Promise<BankerDirectory[]> {
    return await this.bankerDirectoryModel.find().exec();
  }

  async findOne(id: string): Promise<BankerDirectory> {
    const bankerDirectory = await this.bankerDirectoryModel.findById(id).exec();
    if (!bankerDirectory) {
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }
    return bankerDirectory;
  }

  async update(id: string, updateDto: UpdateBankerDirectoryDto) {
    if ((updateDto as any)?.associatedWith) {
      await this.upsertAssociatedOption((updateDto as any).associatedWith);
    }

    return this.bankerDirectoryModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .exec();
  }

  async remove(id: string): Promise<BankerDirectory> {
    const deleted = await this.bankerDirectoryModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Banker Directory with ID ${id} not found`);
    }
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
  ): Promise<{ data: BankerDirectory[]; totalCount: number }> {
    const query: any = {};

    if (state) query.state = { $regex: state, $options: 'i' };
    if (city) query.city = { $regex: city, $options: 'i' };
    if (bankerName) query.bankerName = new RegExp(bankerName, 'i');
    if (associatedWith) query.associatedWith = new RegExp(associatedWith, 'i');
    if (emailOfficial) query.emailOfficial = new RegExp(emailOfficial, 'i');
    if (emailPersonal) query.emailPersonal = new RegExp(emailPersonal, 'i');
    if (product) {query.product = {$in: [new RegExp(`^${product}$`, 'i')], };
}
    const skip = (page - 1) * limit;
    const [data, totalCount] = await Promise.all([
      this.bankerDirectoryModel.find(query).skip(skip).limit(limit).exec(),
      this.bankerDirectoryModel.countDocuments(query),
    ]);

    return { data, totalCount };
  }

  async getStateCityMeta() {
    const rawStates: string[] = await this.bankerDirectoryModel.distinct('state').exec();

    const states = (rawStates || [])
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0)
      .sort((a, b) => a.localeCompare(b));

    const stateCityMap: Record<string, string[]> = {};

    for (const st of states) {
      const rawCities: string[] = await this.bankerDirectoryModel
        .distinct('city', { state: st })
        .exec();

      const cities = (rawCities || [])
        .filter(Boolean)
        .map((c) => String(c).trim())
        .filter((c) => c.length > 0)
        .sort((a, b) => a.localeCompare(b));

      stateCityMap[st] = cities;
    }

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
        errors.push({
          row: i + 2,
          message: 'bankerName and associatedWith are required',
        });
        continue;
      }

      // ✅ AUTO SAVE associatedWith from bulk upload also
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
        errors.push({
          row: i + 2,
          message: e?.message || 'Unknown DB error',
        });
      }
    }

    return { success: true, inserted, updated, skipped, errors };
  }

  async getMyReviews(userId: string) {
    return this.reviewModel
      .find({ createdBy: userId })
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getMyApprovedBankers(userId: string) {
    return this.bankerDirectoryModel
      .find({ createdBy: userId })
      .sort({ createdAt: -1 })
      .exec();
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
