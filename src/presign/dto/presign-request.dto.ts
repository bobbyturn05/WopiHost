import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class PresignRequestDto {
  @IsString()
  @IsNotEmpty()
  bucket: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsIn(['view', 'edit'])
  mode: 'view' | 'edit';
}