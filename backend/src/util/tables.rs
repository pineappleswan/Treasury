use std::error::Error;
use console::style;
pub struct TableBuilder {
  header: Vec<String>,
  records: Vec<Vec<String>>
}

impl TableBuilder {
  pub fn new() -> Self {
    Self {
      header: Vec::new(),
      records: Vec::new()
    }
  }
  
  pub fn set_header_text(&mut self, header: Vec<String>) {
    self.header = header;
  }

  pub fn push_record(&mut self, record: Vec<String>) -> Result<(), Box<dyn Error>> {
    // The column count of each record must match the column count of the header
    if record.len() == self.header.len() {
      self.records.push(record);

      Ok(())
    } else {
      Err(
        format!(
          "Record column length is {} which doesn't match the header column length of {}",
          record.len(),
          self.header.len()
        ).into()
      )
    }
  }

  fn format_record(record: &Vec<String>, column_widths: &Vec<usize>, separator: &str) -> String {
    let mut sections: Vec<String> = Vec::new();

    for (i, column) in record.iter().enumerate() {
      sections.push(format!("{:pad$}", column, pad = column_widths[i]));
    }

    sections.join(&separator)
  }

  pub fn get_table(&self) -> String {
    // Calculate column widths
    let column_count = self.header.len();
    let mut column_widths: Vec<usize> = Vec::with_capacity(column_count);

    for i in 0..column_count {
      let mut max_width = self.header[i].len();

      for record in &self.records {
        max_width = max_width.max(record[i].len());
      }

      column_widths.push(max_width);
    }
    
    // Create body text
    let mut output = TableBuilder::format_record(&self.header, &column_widths, " | ");
    output = style(output).cyan().bold().to_string();

    let mut body: Vec<String> = Vec::new();

    for record in &self.records {
      body.push(TableBuilder::format_record(&record, &column_widths, "   "));
    }

    let body = body.join("\n");

    output.push_str("\n");
    output.push_str(&body);

    output
  }
}
