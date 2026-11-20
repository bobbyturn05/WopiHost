import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class SessionRevocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  bucket: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  key: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  userId?: string;
}
