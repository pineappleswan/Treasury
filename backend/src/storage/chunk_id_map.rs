use std::{collections::BTreeMap, error::Error, io::Cursor, ops::{Deref, DerefMut}};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};

pub struct ChunkIdMap(BTreeMap<u32, u32>);

impl Deref for ChunkIdMap {
  type Target = BTreeMap<u32, u32>;

  fn deref(&self) -> &Self::Target {
    &self.0
  }
}

impl DerefMut for ChunkIdMap {
  fn deref_mut(&mut self) -> &mut Self::Target {
    &mut self.0
  }
}

impl ChunkIdMap {
  pub fn new() -> Self {
    Self(BTreeMap::new())
  }

  /// Serialises the chunk id map into a vector of bytes which can be stored in a database as a blob.
  pub fn serialise(&self) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut chunk_id_map_data: Vec<u32> = vec![0; self.len() * 2];

    for (i, (chunk_id, real_chunk_id)) in self.iter().enumerate() {
      chunk_id_map_data[i * 2 + 0] = *chunk_id;
      chunk_id_map_data[i * 2 + 1] = *real_chunk_id;
    }

    // Convert to array of u8 for writing to file
    let mut serialised_map: Vec<u8> = Vec::new();

    for num in chunk_id_map_data {
      serialised_map.write_u32::<LittleEndian>(num)?;
    }

    Ok(serialised_map)
  }

  /// Deserialises the chunk id map that was serialised into a Vec<u8> by `serialise`.
  pub fn from_serialised(data: Vec<u8>) -> Result<Self, Box<dyn Error>> {
    // Serialised data must be a multiple of 8 as each pair contains two 4 byte chunk ids.
    if data.len() % 8 != 0 {
      return Err("Input data length must be a multple of 8.".into());
    }

    // Each pair is 8 bytes as each chunk id is 4 bytes and there are two of them in each pair.
    let pair_count = data.len() / 8;

    let mut cursor = Cursor::new(data);
    let mut map = ChunkIdMap::new();

    for _ in 0..pair_count {
      let key = cursor.read_u32::<LittleEndian>()?;
      let value = cursor.read_u32::<LittleEndian>()?;

      map.insert(key, value);
    }

    Ok(map)
  }

  /// Maps a chunk id using the map if it's found. Otherwise it will return the same chunk id unmodified.
  pub fn map_chunk_id(&self, chunk_id: u32) -> u32 {
    match self.get(&chunk_id) {
      Some(mapped_id) => *mapped_id,
      None => chunk_id
    }
  }
}