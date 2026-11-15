import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PresignService } from './presign.service';
import { PresignRequestDto } from './dto/presign-request.dto';
import { InternalAuthGuard } from '../common/guards/internal-auth.guard';

@Controller('internal/presign')
@UseGuards(InternalAuthGuard)
export class PresignController {
  constructor(
    private readonly presignService: PresignService,
  ) {}

  @Post()
  create(@Body() dto: PresignRequestDto) {
    return this.presignService.create(dto);
  }
}