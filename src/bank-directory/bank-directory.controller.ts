import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  Patch,
  Req,
} from '@nestjs/common';
import { BankerDirectoryService } from './bank-directory.service';
import { CreateBankerDirectoryDto } from './dto/create-bank-directory.dto';
import { UpdateBankerDirectoryDto } from './dto/update-bank-directory.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Controller('banker-directory')
export class BankerDirectoryController {
  constructor(
    private readonly bankerDirectoryService: BankerDirectoryService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('associated-options')
  async getAssociatedOptions() {
    return this.bankerDirectoryService.getAssociatedOptions();
  }

  @Post('associated-options/upsert')
  async upsertAssociated(@Body('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('name is required');
    }
    return this.bankerDirectoryService.upsertAssociatedOption(name);
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

    return await this.bankerDirectoryService.requestReview(dto, user);
  }

  @Get('review-counts')
  async getReviewCounts() {
    return await this.bankerDirectoryService.getReviewCounts();
  }

  @Get('review-requests')
  async getAllSubmissions() {
    return await this.bankerDirectoryService.getAllReviews();
  }

  @Post('approve-request/:id')
  async approve(@Param('id') id: string) {
    return await this.bankerDirectoryService.approveReview(id);
  }

  @Post('reject-request/:id')
  async reject(@Param('id') id: string, @Body('reason') reason: string) {
    return await this.bankerDirectoryService.rejectReview(id, reason);
  }

  @Post('create-directories')
  async create(@Body() dto: CreateBankerDirectoryDto) {
    return await this.bankerDirectoryService.create(dto);
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
  @Query('page') page: number = 1,
  @Query('limit') limit: number = 10,
) {
  return await this.bankerDirectoryService.filterByLocationAndName(
    state,
    city,
    bankerName,
    associatedWith,
    emailOfficial,
    emailPersonal,
    product,
    +page,
    +limit,
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

    const userId = user._id || user.id || user.sub;
    return this.bankerDirectoryService.getMyReviews(userId);
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
