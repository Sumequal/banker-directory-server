import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  Patch,
  Req,
  Logger,
  Injectable,
  PipeTransform,
  ArgumentMetadata,
  ParseFilePipeBuilder,
  HttpStatus,
} from '@nestjs/common';
import { BankerDirectoryService } from './bank-directory.service';
import { CreateBankerDirectoryDto } from './dto/create-bank-directory.dto';
import { UpdateBankerDirectoryDto } from './dto/update-bank-directory.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Types } from 'mongoose';

interface AuthenticatedUser {
  _id?: string;
  id?: string;
  sub?: string;
  role?: string; // ASSUMPTION: admin yahi field se identify hota hai — confirm kar lena
  [key: string]: any;
}

// Har :id route ke liye reusable — invalid Mongo ObjectId par clean 400 deta hai,
// warna Mongoose ka CastError unhandled 500 ban jata
@Injectable()
class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ${metadata.data} format`);
    }
    return value;
  }
}

@Controller('banker-directory')
export class BankerDirectoryController {
  private readonly logger = new Logger(BankerDirectoryController.name);

  constructor(
    private readonly bankerDirectoryService: BankerDirectoryService,
    private readonly jwtService: JwtService,
  ) {}

  // ==========================
  // Auth helpers
  // ==========================

  /**
   * Authorization header se JWT verify karta hai. Token missing/invalid ho
   * to 401 throw karta hai — "logged in user" maangne wale har route isi
   * se guzarta hai, taaki anonymous request aage hi na badhe.
   */
  private getUserFromRequest(req: Request): AuthenticatedUser {
    const authHeader = req.headers['authorization'] as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication token is required');
    }

    let payload: AuthenticatedUser;
    try {
      payload = this.jwtService.verify(authHeader.slice(7)) as AuthenticatedUser;
    } catch (err: any) {
      this.logger.warn(`JWT verify failed: ${err?.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!(payload?._id || payload?.id || payload?.sub)) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return payload;
  }

  /**
   * ASSUMPTION: JWT payload me 'role' field admin identify karta hai
   * (e.g. { role: 'admin' }). Field ka naam/structure alag hai to
   * bas neeche wali if condition badal dena.
   */
  private requireAdmin(req: Request): AuthenticatedUser {
    const user = this.getUserFromRequest(req);
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return user;
  }

  private getUserId(user: AuthenticatedUser): string {
    return (user._id || user.id || user.sub) as string;
  }

  // ==========================
  // Public lookups
  // ==========================

  @Get('associated-options')
  async getAssociatedOptions() {
    return this.bankerDirectoryService.getAssociatedOptions();
  }

  // NOTE: ye abhi bhi unauthenticated hai — agar sirf logged-in banker ya
  // sirf admin ko naye "associated with" options add karne chahiye, batana
  @Post('associated-options/upsert')
  async upsertAssociated(@Body('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('name is required');
    }
    return this.bankerDirectoryService.upsertAssociatedOption(name.trim());
  }

  // CHANGED: pehle anonymous (user = null) allow ho raha tha; ab login zaroori
  // hai kyunki Review schema me createdBy required hai
  @Post('request-directory')
  async submitForReview(
    @Body() dto: CreateBankerDirectoryDto,
    @Req() req: Request,
  ) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.requestReview(dto, user);
  }

  // ==========================
  // Admin — review queue
  // ==========================

  @Get('review-counts')
  async getReviewCounts(@Req() req: Request) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.getReviewCounts();
  }

  @Get('review-requests')
  async getAllSubmissions(@Req() req: Request) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.getAllReviews();
  }

  @Post('approve-request/:id')
  async approve(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.approveReview(id);
  }

  @Post('reject-request/:id')
  async reject(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    if (!reason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }
    return this.bankerDirectoryService.rejectReview(id, reason.trim());
  }

  // ==========================
  // Self-service profile (logged-in banker)
  // ==========================

  @Get('profile')
  async getMyProfile(@Req() req: Request) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.getMyProfile(user);
  }

  // Public profile view — service layer decide kare ki emailPersonal/contact
  // jaisi fields public response me jani chahiye ya nahi
  @Get('profile/:id')
  async getProfile(@Param('id', ParseObjectIdPipe) id: string) {
    return this.bankerDirectoryService.getProfile(id);
  }

  @Patch('profile')
  async updateMyProfile(
    @Req() req: Request,
    @Body() dto: UpdateBankerDirectoryDto,
  ) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.updateMyProfile(user, dto);
  }

  @Patch('profile/:id')
  async adminUpdate(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateBankerDirectoryDto,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.adminUpdateProfile(id, dto);
  }

  @Patch('profile-image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfileImage(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 }) // 5MB
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.uploadProfileImage(user, file);
  }

  @Patch('cover-image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCoverImage(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.uploadCoverImage(user, file);
  }

  @Delete('profile-image')
  async deleteProfileImage(@Req() req: Request) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.deleteProfileImage(user);
  }

  @Delete('cover-image')
  async deleteCoverImage(@Req() req: Request) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.deleteCoverImage(user);
  }

  @Get('my-review-requests')
  async getMyReviewRequests(@Req() req: Request) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.getMyReviews(this.getUserId(user));
  }

  @Get('my-approved')
  async getMyApproved(@Req() req: Request) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.getMyApprovedBankers(this.getUserId(user));
  }

  // ==========================
  // Admin — direct directory CRUD
  // ==========================

  @Patch('link-user/:id')
  async linkUser(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('userId') userId: string,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    if (!userId?.trim() || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('A valid userId is required');
    }
    return this.bankerDirectoryService.linkUser(id, userId);
  }

  @Post('create-directories')
  async create(@Body() dto: CreateBankerDirectoryDto, @Req() req: Request) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.create(dto);
  }

  @Get('get-directories')
  async findAll(@Req() req: Request) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.findAll();
  }

  @Get('get-directory/:id')
  async findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.findOne(id);
  }

  @Patch('update-directory/:id')
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() updateDto: UpdateBankerDirectoryDto,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.update(id, updateDto);
  }

  // ==========================
  // NEW: Admin — directory image upload BY ID
  // ==========================
  // WHY: profile-image / cover-image (upar) sirf getUserFromRequest() ke
  // logged-in user ke liye kaam karte hain — ye admin ko koi bhi banker
  // directory record (uske linked user account ke bina bhi) edit karne
  // dete hain, jaisa admin "edit banker" screen se expected hai.
  //
  // NOTE: Service me uploadProfileImageById / uploadCoverImageById methods
  // add karne honge — S3 upload wahi existing helper/logic use kare jo
  // uploadProfileImage/uploadCoverImage already use kar rahe hain, bas
  // "user" ke bajaye directory ka `id` se record dhoondh kar update kare.

  @Patch('directory-profile-image/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDirectoryProfileImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 }) // 5MB
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.uploadProfileImageById(id, file);
  }

  @Patch('directory-cover-image/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDirectoryCoverImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.uploadCoverImageById(id, file);
  }

  @Delete('delete-directory/:id')
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.remove(id);
  }

  // ==========================
  // Public search
  // ==========================

  // NOTE: emailPersonal ko public search filter rakhna PII enumeration risk
  // hai — decide kar lena ye chahiye ya nahi
  @Get('filter')
  async filter(
    @Query('state') state?: string,
    @Query('city') city?: string,
    @Query('bankerName') bankerName?: string,
    @Query('emailOfficial') emailOfficial?: string,
    @Query('emailPersonal') emailPersonal?: string,
    @Query('associatedWith') associatedWith?: string,
    @Query('product') product?: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 10));

    return this.bankerDirectoryService.filterByLocationAndName(
      state,
      city,
      bankerName,
      associatedWith,
      emailOfficial,
      emailPersonal,
      product,
      page,
      limit,
    );
  }

  @Get('state-city-meta')
  async getStateCityMeta() {
    return this.bankerDirectoryService.getStateCityMeta();
  }

  @Post('bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUpload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 }) // 10MB
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    this.requireAdmin(req);

    // mimetype Excel/CSV files ke liye browser-to-browser unreliable hota
    // hai, isliye extension se check kar rahe hain
    if (!/\.(csv|xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException('Only .csv, .xlsx, or .xls files are allowed');
    }

    return this.bankerDirectoryService.bulkImportFromBuffer(
      file.buffer,
      file.originalname,
    );
  }

  @Get('user-collections')
  async getUserCollections(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'coins' | 'approved' | 'recent',
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.getUserCollectionsSummary({
      search,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 10)),
      sort: sort || 'coins',
    });
  }
}