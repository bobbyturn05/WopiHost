import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FileIdentityDeleteDto {
  @IsString() @IsNotEmpty() @MaxLength(63) bucket: string;
  @IsString() @IsNotEmpty() @MaxLength(1024) key: string;
}
