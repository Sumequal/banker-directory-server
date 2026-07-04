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
  role?: string;
  [key: string]: any;
}

@Injectable()
class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ${metadata.data} format`);
    }
    return value;
  }
}

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; 

@Controller('banker-directory')
export class BankerDirectoryController {
  private readonly logger = new Logger(BankerDirectoryController.name);

  constructor(
    private readonly bankerDirectoryService: BankerDirectoryService,
    private readonly jwtService: JwtService,
  ) {}


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

  @Get('associated-options')
  async getAssociatedOptions() {
    return this.bankerDirectoryService.getAssociatedOptions();
  }

  @Post('associated-options/upsert')
  async upsertAssociated(@Body('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('name is required');
    }
    return this.bankerDirectoryService.upsertAssociatedOption(name.trim());
  }

  @Post('request-directory')
  async submitForReview(@Body() dto: CreateBankerDirectoryDto, @Req() req: Request) {
    let user: any = null;

    const authHeader = (req.headers['authorization'] ||
      req.headers['Authorization']) as string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        user = this.jwtService.verify(token);
      } catch (e: any) {
        console.warn('JWT verify failed in /request-directory:', e?.message);
      }
    }

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

  @Get('profile')
  async getMyProfile(@Req() req: Request) {
    const user = this.getUserFromRequest(req);
    return this.bankerDirectoryService.getMyProfile(user);
  }

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
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_SIZE })
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
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_SIZE })
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
  async findAll() {
    return await this.bankerDirectoryService.findAll();
  }

   @Get('get-directory/:id')
  async findOne(@Param('id') id: string) {
    return await this.bankerDirectoryService.findOne(id);
  }

  @Patch('update-directory/:id')
  async update(@Param('id') id: string, @Body() updateDto: UpdateBankerDirectoryDto) {
    return this.bankerDirectoryService.update(id, updateDto);
  }


  @Patch('directory-profile-image/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDirectoryProfileImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_SIZE })
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
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_SIZE })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    this.requireAdmin(req);
    return this.bankerDirectoryService.uploadCoverImageById(id, file);
  }

  @Delete('delete-directory/:id')
  async remove(@Param('id') id: string) {
    return await this.bankerDirectoryService.remove(id);
  }

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
  async bulkUpload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.bankerDirectoryService.bulkImportFromBuffer(
      file.buffer,
      file.originalname,
    );
  }

  @Get('my-review-requests')
  async getMyReviewRequests(@Req() req: Request) {
    let user: any = null;

    const authHeader = (req.headers['authorization'] ||
      req.headers['Authorization']) as string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        user = this.jwtService.verify(token);
      } catch (e: any) {
        console.warn('JWT verify failed in /my-review-requests:', e?.message);
      }
    }

    if (!user || !(user._id || user.id || user.sub)) {
      throw new BadRequestException('User not identified from token');
    }
  }

  @Get('my-approved')
  async getMyApproved(@Req() req: Request) {
    let user: any = null;

    const authHeader = (req.headers['authorization'] ||
      req.headers['Authorization']) as string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        user = this.jwtService.verify(token);
      } catch (e: any) {
        console.warn('JWT verify failed in /my-approved:', e?.message);
      }
    }

    if (!user || !(user._id || user.id || user.sub)) {
      throw new BadRequestException('User not identified from token');
    }

    const userId = user._id || user.id || user.sub;
    return this.bankerDirectoryService.getMyApprovedBankers(userId);
  }

   @Get('user-collections')
  async getUserCollections(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'coins' | 'approved' | 'recent',
  ) {
    return this.bankerDirectoryService.getUserCollectionsSummary({
      search,
      page: Number(page || 1),
      limit: Number(limit || 10),
      sort: (sort as any) || 'coins',
    });
  }
}