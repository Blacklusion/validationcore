import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, JoinColumn } from "typeorm";
import { HttpErrorType } from "../enum/HttpErrorType";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Stores the validation results of an NodeApi validation
 */
@Entity()
export class NodeApi {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "smallint", nullable: false })
  instance_id: number;

  @Column({ length: 12 })
  guild: string;

  @CreateDateColumn()
  validation_date: Date;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.ERROR })
  all_checks_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  location_ok: ValidationLevel;

  @Column({ type: "decimal", precision: 9, scale: 6, nullable: true })
  location_longitude: number;

  @Column({ type: "decimal", precision: 8, scale: 6,  nullable: true })
  location_latitude: number;

  @Column({ nullable: false })
  endpoint_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  endpoint_url_ok: ValidationLevel;



  @Column({ default: false })
  is_ssl: boolean;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  ssl_ok: ValidationLevel;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  ssl_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_info_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  get_info_ms: number;

  @Column({ type: "smallint", nullable: true })
  get_info_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_info_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  server_version_ok: ValidationLevel;

  @Column({ nullable: true })
  server_version: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  correct_chain: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  head_block_delta_ok: ValidationLevel;

  @Column({ type: "bigint", nullable: true })
  head_block_delta_ms: number;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  block_one_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  block_one_ms: number;

  @Column({ type: "smallint", nullable: true })
  block_one_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  block_one_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  verbose_error_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  verbose_error_ms: number;

  @Column({ type: "smallint", nullable: true })
  verbose_error_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  verbose_error_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  abi_serializer_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  abi_serializer_ms: number;

  @Column({ type: "smallint", nullable: true })
  abi_serializer_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  abi_serializer_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  basic_symbol_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  basic_symbol_ms: number;

  @Column({ type: "smallint", nullable: true })
  basic_symbol_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  basic_symbol_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  producer_api_off: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  producer_api_ms: number;

  @Column({ type: "smallint", nullable: true })
  producer_api_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  producer_api_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  db_size_api_off: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  db_size_api_ms: number;

  @Column({ type: "smallint", nullable: true })
  db_size_api_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  db_size_api_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  net_api_off: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  net_api_ms: number;

  @Column({ type: "smallint", nullable: true })
  net_api_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  net_api_errortype: HttpErrorType;
}
