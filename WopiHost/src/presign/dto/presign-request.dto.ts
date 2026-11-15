import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PresignRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  bucket: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  userId: string;

  @IsIn(['view', 'edit'])
  mode: 'view' | 'edit';
}