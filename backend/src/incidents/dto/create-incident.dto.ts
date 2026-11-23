import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Payload validation DTO for creating an incident.
 */
export class CreateIncidentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  zone!: string;
}
