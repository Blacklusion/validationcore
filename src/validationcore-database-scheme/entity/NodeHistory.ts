import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";
import { HttpErrorType } from "../enum/HttpErrorType";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Store the validation results of a NodeHistory validation
 */
@Entity()
export class NodeHistory {
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
  get_transaction_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  get_transaction_ms: number;

  @Column({ type: "smallint", nullable: true })
  get_transaction_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_transaction_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_actions_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  get_actions_ms: number;

  @Column({ nullable: true })
  get_actions_message: string;

  @Column({ type: "smallint", nullable: true })
  get_actions_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_actions_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_key_accounts_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  get_key_accounts_ms: number;

  @Column({ type: "smallint", nullable: true })
  get_key_accounts_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_key_accounts_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_controlled_accounts_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  get_controlled_accounts_ms: number;

  @Column({ type: "smallint", nullable: true })
  get_controlled_accounts_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_controlled_accounts_errortype: HttpErrorType;
}
