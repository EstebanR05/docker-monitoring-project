import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { Incident } from './incident.interface';
import { IncidentsService } from './incidents.service';

/**
 * HTTP controller for incident CRUD endpoints.
 */
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  findAll(): Incident[] {
    return this.incidentsService.findAll();
  }

  @Post()
  create(@Body() createIncidentDto: CreateIncidentDto): Incident {
    return this.incidentsService.create(createIncidentDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Incident {
    return this.incidentsService.findOne(id);
  }
}
